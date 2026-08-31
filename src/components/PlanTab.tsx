import * as React from 'react';

import { ConfirmButton } from '@/components/ConfirmButton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { BauItem } from '@/lib/bau';
import { buildPlanText, mergeGoalText, type MergeMode } from '@/lib/plan';
import { MAX_SPRINT_NAME, nextSprintName, sprintLabel, type Sprint } from '@/lib/sprints';
import type { TeamConfig } from '@/lib/teams';
import { cn } from '@/lib/utils';

/**
 * The Plan tab: set next sprint's goals from here instead of from Jira.
 *
 * The retro tab reads a sprint that has happened; this one writes a sprint that
 * has not. It shares the team picker with the retro (same team context, same
 * BAU list) and is otherwise its own small flow:
 *
 *   compose the goal lines → see exactly what will be pushed → pick the target
 *   sprint → push.
 *
 * ## The preview is not a preview
 *
 * The `<pre>` below renders `buildPlanText(...)` and the push sends
 * `buildPlanText(...)` — the same call, not two renderings that are supposed to
 * agree. That matters more here than anywhere else in the app: the push writes
 * a shared Jira field that the whole team reads, and "the box showed something
 * slightly different from what it sent" is the one bug a preview exists to make
 * impossible.
 *
 * ## Why the fast path never sees a dialog
 *
 * A future sprint's goal field is almost always empty — it is a sprint nobody
 * has planned yet, which is the entire reason to be on this tab. So an empty
 * target goes behind the same in-place confirm popover as every other write in
 * the app: one click, one confirm, done. A target that *already* has a goal is
 * the rare case, and it is the only one that opens the dialog, because it is
 * the only one where a decision (keep it? replace it?) actually exists.
 */

const hint = 'mt-1.5 mb-0 text-[0.8125rem] text-muted';
const helper = 'text-[0.8125rem] text-muted';

export interface PlanTabProps {
  team: TeamConfig;
  /** Human-facing Space name read from Jira, with the config fallback applied. */
  spaceName: string;
  /** Future sprints on the board, as `/api/sprints` reported them. */
  future: Sprint[];
  /** Newest sprint name on the board, for suggesting the next one. */
  latestName: string | null;
  /** The team's standing BAU list, appended to every push unchecked. */
  bauItems: BauItem[];
  /** The retro tab's unfinished goals, for the seed button. */
  seedText: string;
  /** The sprint that supplies `seedText`, named so the action is unambiguous. */
  sourceSprintName: string | null;
  /** Whether Jira targets are loading, usable, or unavailable. */
  targetLoadState: 'loading' | 'ready' | 'error';
  /** Jira's target-loading error, shown in this tab rather than hidden in Retro. */
  targetLoadError: string;
  /** Retry loading the target sprints after an error. */
  onRetry: () => void | Promise<void>;
  /** Refetch the sprint list after a create or a push. */
  onRefresh: () => void | Promise<void>;
}

export function PlanTab({ team, ...props }: PlanTabProps) {
  /*
   * A Space change is a new planning session. Keying the stateful form by the
   * Space resets every transient field at once and unmounts pending requests,
   * while each Space's typed draft still comes back from localStorage.
   */
  return <PlanTabForSpace key={team.id} team={team} {...props} />;
}

function PlanTabForSpace({
  team,
  spaceName,
  future,
  latestName,
  bauItems,
  seedText,
  sourceSprintName,
  targetLoadState,
  targetLoadError,
  onRetry,
  onRefresh,
}: PlanTabProps) {
  /**
   * The composer's text, per team. Kept in localStorage so a plan half-written
   * on Friday is still there on Monday — it is typed work, exactly like a
   * retro draft, and losing it to a reload would be the same insult.
   */
  const storageKey = `plan:${team.id}`;
  const [goalText, setGoalText] = React.useState(() => readStore(storageKey) ?? '');

  React.useEffect(() => {
    writeStore(storageKey, goalText);
  }, [storageKey, goalText]);

  /** Which future sprint to push into; defaults to the first (soonest). */
  const [targetId, setTargetId] = React.useState<number | null>(null);
  const target = future.find((sprint) => sprint.id === targetId) ?? future[0] ?? null;

  const [status, setStatus] = React.useState<{ text: string; warn: boolean }>({
    text: '',
    warn: false,
  });
  const [pushing, setPushing] = React.useState(false);
  const active = React.useRef(true);
  const requests = React.useRef(new Set<AbortController>());
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      for (const request of requests.current) request.abort();
      requests.current.clear();
    };
  }, []);

  /** The create-sprint flow, shown only when the board has no future sprint. */
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [createBusy, setCreateBusy] = React.useState(false);

  /** The append/replace dialog, for a target that already has a goal. */
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeText, setMergeText] = React.useState('');
  const [mergeMode, setMergeMode] = React.useState<MergeMode | null>(null);
  const [lastSuccessfulPush, setLastSuccessfulPush] = React.useState<{
    targetId: number;
    sourcePlanText: string;
    sentText: string;
  } | null>(null);

  /**
   * THE text. One call, used by the preview, by the push, and by the dialog's
   * two fill actions — so there is no second path that could render something
   * other than what is sent.
  */
  const planText = buildPlanText(goalText, bauItems);
  /**
   * The goals-only prefix of `planText`, so the preview can dim the appended
   * BAU tail. Derived from the same builder — the dimmed split can never
   * disagree with what is pushed.
   */
  const goalsOnlyText = buildPlanText(goalText, []);
  const bauTailText = planText.slice(goalsOnlyText.length);
  const targetGoal = String(target?.goal ?? '');
  const alreadyPushed =
    planText !== '' &&
    target !== null &&
    (targetGoal === planText ||
      (lastSuccessfulPush !== null &&
        lastSuccessfulPush.targetId === target.id &&
        lastSuccessfulPush.sourcePlanText === planText &&
        lastSuccessfulPush.sentText === targetGoal));
  const sourceLabel = sourceSprintName?.trim() || 'this retro draft';

  const seed = () => {
    if (seedText === '') {
      setStatus({
        text: 'No unfinished goals in the retro to seed from.',
        warn: false,
      });
      return;
    }
    setGoalText(seedText);
    const count = seedText.split('\n').length;
    setStatus({
      text: `Seeded ${count} unfinished goal${count === 1 ? '' : 's'} from ${sourceLabel}.`,
      warn: false,
    });
  };

  /** Write `text` to the target sprint's goal. The one network write here. */
  const push = async (text: string) => {
    if (!target || pushing) return;
    const request = new AbortController();
    requests.current.add(request);
    setPushing(true);
    setStatus({ text: `Pushing to ${target.name}…`, warn: false });

    try {
      const response = await fetch('/api/set-goal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          team: team.id,
          sprintId: target.id,
          goal: text,
        }),
        signal: request.signal,
      });
      if (!active.current) return;

      if (!response.ok) {
        // Surface Jira's own reason: 403 means the token's user lacks the
        // "Manage sprints" permission, which is actionable.
        let message = 'Could not set the sprint goal.';
        try {
          const body = (await response.json()) as { error?: string };
          if (!active.current) return;
          if (typeof body.error === 'string' && body.error !== '') message = body.error;
        } catch {
          /* keep the generic message */
        }
        if (!active.current) return;
        setStatus({ text: message, warn: true });
        return;
      }

      setMergeOpen(false);
      setLastSuccessfulPush({
        targetId: target.id,
        sourcePlanText: planText,
        sentText: text,
      });
      setStatus({ text: `Pushed to ${target.name} in Jira.`, warn: false });
      // Refetch so the target's goal — now non-empty — is what the next push
      // sees. Without this a second push would still think it was empty.
      if (active.current) await onRefresh();
    } catch (error) {
      if (!active.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      setStatus({
        text: 'Could not reach the server to set the goal.',
        warn: true,
      });
    } finally {
      requests.current.delete(request);
      if (active.current) setPushing(false);
    }
  };

  /**
   * The push button's behaviour, which depends entirely on the target.
   *
   * Empty goal — the overwhelmingly common case — runs straight through the
   * confirm popover. A goal that is already there opens the dialog, because
   * that is where a real decision has to be made.
   */
  const startPush = () => {
    if (!target || planText === '') return;
    if (alreadyPushed) {
      setStatus({ text: `Already pushed to ${target.name}.`, warn: false });
      return;
    }
    if (String(target.goal ?? '').trim() === '') {
      void push(planText);
      return;
    }
    setMergeText(mergeGoalText(target.goal, planText, 'append'));
    setMergeMode('append');
    setMergeOpen(true);
  };

  const createSprint = async () => {
    const name = newName.trim();
    if (name === '' || createBusy) return;
    const request = new AbortController();
    requests.current.add(request);
    setCreateBusy(true);
    setStatus({ text: `Creating ${name} in Jira…`, warn: false });

    try {
      const response = await fetch('/api/create-sprint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team: team.id, name }),
        signal: request.signal,
      });
      if (!active.current) return;

      if (!response.ok) {
        let message = 'Could not create the sprint.';
        try {
          const body = (await response.json()) as { error?: string };
          if (!active.current) return;
          if (typeof body.error === 'string' && body.error !== '') message = body.error;
        } catch {
          /* keep the generic message */
        }
        if (!active.current) return;
        setStatus({ text: message, warn: true });
        return;
      }

      const body = (await response.json()) as { sprint?: { id?: number } };
      if (!active.current) return;
      setCreating(false);
      setStatus({
        text: `Created ${name}. It is now the target.`,
        warn: false,
      });
      // Select the new sprint, then refetch so it arrives with its real fields.
      if (typeof body.sprint?.id === 'number') setTargetId(body.sprint.id);
      if (active.current) await onRefresh();
    } catch (error) {
      if (!active.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      setStatus({
        text: 'Could not reach the server to create the sprint.',
        warn: true,
      });
    } finally {
      requests.current.delete(request);
      if (active.current) setCreateBusy(false);
    }
  };

  const suggestedName = nextSprintName(latestName);
  /** Jira refuses a name of 30 characters or more; say so before the request. */
  const nameTooLong = newName.trim().length > MAX_SPRINT_NAME;

  return (
    <div>
      {/*
        ───────────────────────────────────────────────────────────────────
        The composer. One goal per line, exactly as it will be pushed.
      */}
      <section
        className="relative border-t-0 py-8 pl-10 before:absolute before:top-8 before:bottom-0 before:left-[0.6875rem] before:w-px before:bg-rule max-sm:pl-9"
        aria-labelledby="heading-plan-goals"
      >
        <h2
          id="heading-plan-goals"
          className="mb-5 flex min-h-6 items-center text-sm font-semibold text-ink"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand bg-brand-soft text-xs font-semibold text-brand [font-variant-numeric:tabular-nums]"
          >
            1
          </span>
          Next sprint’s goals
        </h2>

        {/*
          The section lays out the *payload in push order* — the goal lines you
          type, then the BAU tail that rides along — and only then the tools.
          The earlier order (textarea, hint, seed button, BAU) split the two
          halves of the payload with a control that edits only the top half,
          which made the BAU block read as an appendix of the seed action
          rather than as part of what gets pushed.
        */}
        <Label htmlFor="plan-goals">Goal lines</Label>
        <Textarea
          id="plan-goals"
          value={goalText}
          placeholder="One goal per line"
          className="min-h-32"
          onChange={(event) => setGoalText(event.target.value)}
        />

        {/*
          The BAU tail, directly under the box it will be appended to, in its
          own quiet band — one contained region instead of loose fragments.
          Read-only here on purpose: the standing list is curated in the Retro
          tab, and a delete control on the plan would make "trim this push"
          quietly destroy the team's inventory.
        */}
        <div className="mt-1.5 rounded-[var(--radius-control)] border border-rule bg-canvas px-2.5 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="m-0 text-[0.8125rem] font-semibold text-ink">BAU</p>
            <span className={helper}>
              {bauItems.length === 0
                ? 'nothing to append yet — add items in the Retro tab'
                : `${bauItems.length} item${bauItems.length === 1 ? '' : 's'} appended to every push, unticked. Edit in the Retro tab.`}
            </span>
          </div>
          {bauItems.length > 0 && (
            <ul className="m-0 mt-1 list-none p-0">
              {bauItems.map((item) => (
                <li
                  key={item.id}
                  className="flex min-h-8 items-center gap-2.5 py-1 text-[0.8125rem] text-ink [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule"
                >
                  {/* The unticked box the push writes, drawn, not typed. */}
                  <span
                    aria-hidden="true"
                    className="inline-block size-[0.875rem] shrink-0 rounded-[3px] border border-field bg-paper"
                  />
                  {item.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {goalText.trim() === '' ? (
            <Button variant="quiet" onClick={seed} disabled={seedText === ''}>
              Seed from retro
            </Button>
          ) : (
            <ConfirmButton
              variant="quiet"
              question={`Replace the plan above with unfinished goals from ${sourceLabel}?`}
              confirmLabel="Replace goals"
              disabled={seedText === ''}
              onConfirm={seed}
            >
              Seed from retro
            </ConfirmButton>
          )}
          <span className={helper}>
            {seedText === ''
              ? `Nothing unfinished in ${sourceLabel} to carry over.`
              : `Fills the box with unfinished goals from ${sourceLabel}.`}
          </span>
        </div>
      </section>

      {/*
        ───────────────────────────────────────────────────────────────────
        The preview. Byte-for-byte what Jira gets — same function as the push.
      */}
      <section
        className="relative border-t border-rule py-8 pl-10 before:absolute before:top-0 before:bottom-0 before:left-[0.6875rem] before:w-px before:bg-rule max-sm:pl-9"
        aria-labelledby="heading-plan-preview"
      >
        <h2
          id="heading-plan-preview"
          className="mb-5 flex min-h-6 items-center text-sm font-semibold text-ink"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand bg-brand-soft text-xs font-semibold text-brand [font-variant-numeric:tabular-nums]"
          >
            2
          </span>
          What Jira will get
        </h2>

        {planText === '' ? (
          <p className="m-0 flex min-h-11 items-center rounded-[var(--radius-control)] border border-dashed border-rule px-2.5 text-[0.8125rem] text-muted">
            Nothing to push yet. Add a goal line above, or a BAU item in the retro.
          </p>
        ) : (
          /*
            A monospaced block on ruled paper: this is machine text about to be
            written somewhere else, and setting it in the form's own prose face
            would invite reading it as prose rather than as the literal payload.
          */
          <pre
            data-testid="plan-preview"
            className="m-0 overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-ink"
          >
            {/*
              The BAU tail is dimmed so the two populations read apart: the
              goals are what you typed above, the grey block is the standing
              list riding along. Same string as the push either way.
            */}
            {goalsOnlyText}
            {bauTailText !== '' && <span className="text-muted">{bauTailText}</span>}
          </pre>
        )}
      </section>

      {/*
        ───────────────────────────────────────────────────────────────────
        The target, and the push.
      */}
      <section
        className="relative border-t border-rule py-8 pb-0 pl-10 before:absolute before:top-0 before:bottom-0 before:left-[0.6875rem] before:w-px before:bg-rule max-sm:pl-9"
        aria-labelledby="heading-plan-target"
      >
        <h2
          id="heading-plan-target"
          className="mb-5 flex min-h-6 items-center text-sm font-semibold text-ink"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand bg-brand-soft text-xs font-semibold text-brand [font-variant-numeric:tabular-nums]"
          >
            3
          </span>
          Target sprint
        </h2>

        {targetLoadState === 'loading' ? (
          <p className={cn(helper, 'm-0')}>Loading sprints…</p>
        ) : targetLoadState === 'error' ? (
          <div
            className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-warn"
            role="alert"
          >
            <p className="m-0 text-[0.8125rem] font-medium">
              {targetLoadError || 'Could not load future sprints from Jira.'}
            </p>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => void onRetry()}>
              Retry
            </Button>
          </div>
        ) : future.length === 0 ? (
          /*
            No future sprint exists. Rather than a dead end, offer to create
            one with the obvious name — the board's own series, incremented.
          */
          <div>
            {creating ? (
              <div>
                <Label htmlFor="plan-new-sprint">New sprint name</Label>
                <Input
                  id="plan-new-sprint"
                  autoComplete="off"
                  value={newName}
                  placeholder={suggestedName || 'Sprint name'}
                  maxLength={MAX_SPRINT_NAME}
                  aria-describedby="plan-new-sprint-hint"
                  onChange={(event) => setNewName(event.target.value)}
                />
                <p id="plan-new-sprint-hint" className={hint}>
                  Created as a future sprint on the {spaceName} board. Dates are set in Jira when it
                  starts.
                  {/*
                    Jira's own ceiling, and not a documented one — the API
                    answers a bare 400 for a longer name. Said here, while the
                    field is being typed into, rather than after a round trip.
                  */}
                  {nameTooLong && ` Jira limits the name to ${MAX_SPRINT_NAME} characters.`}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <ConfirmButton
                    variant="default"
                    question={`Create "${newName.trim()}" as a future sprint on the ${spaceName} board?`}
                    confirmLabel="Create sprint"
                    disabled={createBusy || newName.trim() === '' || nameTooLong}
                    onConfirm={() => void createSprint()}
                  >
                    {createBusy ? 'Creating…' : 'Create sprint'}
                  </ConfirmButton>
                  <Button variant="ghost" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewName(suggestedName);
                    setCreating(true);
                  }}
                >
                  Create sprint
                </Button>
                <span className={helper}>
                  The {spaceName} board has no future sprint to push into.
                  {suggestedName !== '' && ` Next would be “${suggestedName}”.`}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div>
            {/*
              One future sprint is the normal case and needs no picker — the
              answer is not in question. Several means the board is planned
              ahead, and then which one genuinely is a choice.
            */}
            {future.length === 1 ? (
              <p className="m-0">
                <span className="text-[0.9375rem]">{sprintLabel(future[0]!)}</span>
              </p>
            ) : (
              <div className="max-w-sm">
                <Label htmlFor="plan-target">Sprint</Label>
                <Select
                  value={String(target?.id ?? '')}
                  onValueChange={(next) => setTargetId(Number(next))}
                >
                  <SelectTrigger id="plan-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {future.map((sprint) => (
                      <SelectItem key={sprint.id} value={String(sprint.id)}>
                        {sprintLabel(sprint)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Say when the target is not empty, before the button is pressed. */}
            {target && String(target.goal ?? '').trim() !== '' && !alreadyPushed ? (
              <p className={cn(hint, 'mt-3')}>
                This sprint already has a goal. Pushing will ask whether to add to it or replace it.
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <ConfirmButton
                variant="default"
                question={`Write these goals into ${target?.name ?? 'the sprint'} in Jira?`}
                confirmLabel="Push"
                // A target that already has a goal opens the dialog instead,
                // and that dialog is its own confirmation — asking twice for
                // the same write is noise.
                needsConfirm={String(target?.goal ?? '').trim() === ''}
                disabled={pushing || planText === '' || !target || alreadyPushed}
                onConfirm={startPush}
              >
                {pushing ? 'Pushing…' : alreadyPushed ? 'Already pushed' : 'Push to Jira'}
              </ConfirmButton>
              <span className={helper}>
                {planText === ''
                  ? 'Nothing to push yet.'
                  : alreadyPushed
                    ? `This plan has already been pushed to ${target?.name ?? 'the sprint'}.`
                    : `Writes the text above into ${target?.name ?? 'the sprint'}’s goal field.`}
              </span>
            </div>
          </div>
        )}

        <p
          className={cn(
            hint,
            'mt-4 min-h-[1.125rem]',
            status.warn &&
              'rounded-[var(--radius-control)] bg-warn-soft px-2 py-1 font-medium text-warn',
          )}
          role="status"
          aria-live="polite"
        >
          {status.text}
        </p>
      </section>

      {/*
        ───────────────────────────────────────────────────────────────────
        The merge dialog: only ever reached when the target already has a goal.

        It shows the current goal beside an editable final text, with Append and
        Replace as one-tap *fills* of that box rather than as direct actions.
        The distinction matters: whichever you tap, what gets pushed is what is
        in the box, and you can still edit it afterwards. The box is the truth,
        the two buttons are shortcuts to a starting point.
      */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent aria-describedby="merge-description">
          <DialogTitle>{target?.name ?? 'Sprint'} already has a goal</DialogTitle>
          <DialogDescription id="merge-description" className="mt-1.5">
            Choose what to write. You can edit the result before pushing.
          </DialogDescription>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p id="merge-current-label" className="mb-1.5 text-[0.8125rem] font-medium text-ink">
                Currently in Jira
              </p>
              <pre
                id="merge-current"
                aria-labelledby="merge-current-label"
                data-testid="merge-current"
                className="m-0 max-h-56 overflow-auto rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-muted"
              >
                {target?.goal ?? ''}
              </pre>
            </div>

            <div>
              <Label htmlFor="merge-text">What will be written</Label>
              <Textarea
                id="merge-text"
                data-testid="merge-text"
                value={mergeText}
                className="min-h-56 font-mono text-[0.8125rem]"
                onChange={(event) => {
                  setMergeText(event.target.value);
                  // Hand-editing means neither preset describes it any more.
                  setMergeMode(null);
                }}
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {(
              [
                ['append', 'Append', 'Keeps the current goal and adds the new text after it.'],
                ['replace', 'Replace', 'Discards the current goal.'],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                size="sm"
                variant={mergeMode === mode ? 'default' : 'outline'}
                aria-pressed={mergeMode === mode}
                onClick={() => {
                  setMergeText(mergeGoalText(target?.goal ?? '', planText, mode));
                  setMergeMode(mode);
                }}
              >
                {label}
              </Button>
            ))}
            <span className={helper}>
              {mergeMode === 'replace'
                ? 'The current goal will be discarded.'
                : 'The current goal is kept, with the new text after it.'}
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-rule pt-5">
            <Button
              variant="default"
              disabled={pushing || mergeText.trim() === ''}
              onClick={() => void push(mergeText)}
            >
              {pushing ? 'Pushing…' : 'Push to Jira'}
            </Button>
            <Button variant="ghost" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** localStorage throws in private browsing and when the quota is full. */
function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the tab still works; the plan just doesn't survive a reload */
  }
}
