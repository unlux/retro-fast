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
  /** Refetch the sprint list after a create or a push. */
  onRefresh: () => void | Promise<void>;
  /** Whether the sprint list is still loading. */
  loading: boolean;
}

export function PlanTab({
  team,
  spaceName,
  future,
  latestName,
  bauItems,
  seedText,
  onRefresh,
  loading,
}: PlanTabProps) {
  /**
   * The composer's text, per team. Kept in localStorage so a plan half-written
   * on Friday is still there on Monday — it is typed work, exactly like a
   * retro draft, and losing it to a reload would be the same insult.
   */
  const storageKey = `plan:${team.id}`;
  const [goalText, setGoalText] = React.useState(() => readStore(storageKey) ?? '');

  // Swap the draft when the team changes; the tab shares the retro's picker.
  const lastTeam = React.useRef(team.id);
  React.useEffect(() => {
    if (lastTeam.current === team.id) return;
    lastTeam.current = team.id;
    setGoalText(readStore(`plan:${team.id}`) ?? '');
    setTargetId(null);
  }, [team.id]);

  React.useEffect(() => {
    writeStore(storageKey, goalText);
  }, [storageKey, goalText]);

  /** Which future sprint to push into; defaults to the first (soonest). */
  const [targetId, setTargetId] = React.useState<number | null>(null);
  const target =
    future.find((sprint) => sprint.id === targetId) ?? future[0] ?? null;

  const [status, setStatus] = React.useState<{ text: string; warn: boolean }>({
    text: '',
    warn: false,
  });
  const [pushing, setPushing] = React.useState(false);
  const [pushed, setPushed] = React.useState(false);
  const pushedTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(pushedTimer.current), []);

  /** The create-sprint flow, shown only when the board has no future sprint. */
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [createBusy, setCreateBusy] = React.useState(false);

  /** The append/replace dialog, for a target that already has a goal. */
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeText, setMergeText] = React.useState('');
  const [mergeMode, setMergeMode] = React.useState<MergeMode | null>(null);

  /**
   * THE text. One call, used by the preview, by the push, and by the dialog's
   * two fill actions — so there is no second path that could render something
   * other than what is sent.
   */
  const planText = buildPlanText(goalText, bauItems);

  const seed = () => {
    if (seedText === '') {
      setStatus({ text: 'No unfinished goals in the retro to seed from.', warn: false });
      return;
    }
    setGoalText(seedText);
    const count = seedText.split('\n').length;
    setStatus({
      text: `Seeded ${count} unfinished goal${count === 1 ? '' : 's'} from the retro.`,
      warn: false,
    });
  };

  /** Write `text` to the target sprint's goal. The one network write here. */
  const push = async (text: string) => {
    if (!target || pushing) return;
    setPushing(true);
    setStatus({ text: `Pushing to ${target.name}…`, warn: false });

    try {
      const response = await fetch('/api/set-goal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team: team.id, sprintId: target.id, goal: text }),
      });

      if (!response.ok) {
        // Surface Jira's own reason: 403 means the token's user lacks the
        // "Manage sprints" permission, which is actionable.
        let message = 'Could not set the sprint goal.';
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === 'string' && body.error !== '') message = body.error;
        } catch {
          /* keep the generic message */
        }
        setStatus({ text: message, warn: true });
        return;
      }

      setMergeOpen(false);
      setPushed(true);
      window.clearTimeout(pushedTimer.current);
      pushedTimer.current = window.setTimeout(() => setPushed(false), 1600);
      setStatus({ text: `Pushed to ${target.name} in Jira.`, warn: false });
      // Refetch so the target's goal — now non-empty — is what the next push
      // sees. Without this a second push would still think it was empty.
      await onRefresh();
    } catch {
      setStatus({ text: 'Could not reach the server to set the goal.', warn: true });
    } finally {
      setPushing(false);
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
    if (String(target.goal ?? '').trim() === '') {
      void push(planText);
      return;
    }
    // Default the editable box to Append: keeping what somebody already wrote
    // is the recoverable choice, so it is the one that is pre-filled.
    setMergeText(mergeGoalText(target.goal, planText, 'append'));
    setMergeMode('append');
    setMergeOpen(true);
  };

  const createSprint = async () => {
    const name = newName.trim();
    if (name === '' || createBusy) return;
    setCreateBusy(true);
    setStatus({ text: `Creating ${name} in Jira…`, warn: false });

    try {
      const response = await fetch('/api/create-sprint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team: team.id, name }),
      });

      if (!response.ok) {
        let message = 'Could not create the sprint.';
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === 'string' && body.error !== '') message = body.error;
        } catch {
          /* keep the generic message */
        }
        setStatus({ text: message, warn: true });
        return;
      }

      const body = (await response.json()) as { sprint?: { id?: number } };
      setCreating(false);
      setStatus({ text: `Created ${name}. It is now the target.`, warn: false });
      // Select the new sprint, then refetch so it arrives with its real fields.
      if (typeof body.sprint?.id === 'number') setTargetId(body.sprint.id);
      await onRefresh();
    } catch {
      setStatus({ text: 'Could not reach the server to create the sprint.', warn: true });
    } finally {
      setCreateBusy(false);
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

        <Label htmlFor="plan-goals">Goal lines</Label>
        <Textarea
          id="plan-goals"
          value={goalText}
          placeholder="One goal per line"
          className="min-h-32"
          onChange={(event) => setGoalText(event.target.value)}
        />
        <p className={hint}>
          One per line. The team’s BAU list is added underneath automatically, all unticked.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="quiet" onClick={seed} disabled={seedText === ''}>
            Seed from retro
          </Button>
          <span className={helper}>
            {seedText === ''
              ? 'Nothing unfinished in the retro to carry over.'
              : 'Fills the box with the retro’s unfinished goals.'}
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
            {planText}
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

        {loading ? (
          <p className={cn(helper, 'm-0')}>Loading sprints…</p>
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
                  autoFocus
                  autoComplete="off"
                  value={newName}
                  placeholder={suggestedName || 'Sprint name'}
                  maxLength={MAX_SPRINT_NAME}
                  aria-describedby="plan-new-sprint-hint"
                  onChange={(event) => setNewName(event.target.value)}
                />
                <p id="plan-new-sprint-hint" className={hint}>
                  Created as a future sprint on the {spaceName} board. Dates are set in Jira
                  when it starts.
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
            {target && String(target.goal ?? '').trim() !== '' && (
              <p className={cn(hint, 'mt-3')}>
                This sprint already has a goal. Pushing will ask whether to add to it or
                replace it.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <ConfirmButton
                variant="default"
                question={`Write these goals into ${target?.name ?? 'the sprint'} in Jira?`}
                confirmLabel="Push"
                // A target that already has a goal opens the dialog instead,
                // and that dialog is its own confirmation — asking twice for
                // the same write is noise.
                needsConfirm={String(target?.goal ?? '').trim() === ''}
                disabled={pushing || planText === '' || !target}
                onConfirm={startPush}
              >
                {pushing ? 'Pushing…' : pushed ? 'Pushed' : 'Push to Jira'}
              </ConfirmButton>
              <span className={helper}>
                {planText === ''
                  ? 'Nothing to push yet.'
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
              <Label htmlFor="merge-current">Currently in Jira</Label>
              <pre
                id="merge-current"
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
