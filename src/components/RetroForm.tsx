import * as React from 'react';

import { ConfirmButton } from '@/components/ConfirmButton';
import { GoalList } from '@/components/GoalList';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
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
import {
  buildMailto,
  buildTitle,
  formatHtml,
  formatPlain,
  normalizeStatus,
  normalizeStatusPosition,
  type Goal,
  type RetroState,
  type StatusPosition,
} from '@/lib/format';
import { splitGoals } from '@/lib/split-goals';
import { sprintLabel, sprintNumber, type Sprint } from '@/lib/sprints';
import type { TeamConfig } from '@/lib/teams';
import { cn } from '@/lib/utils';

/** Manual mode has no Jira sprint id, so drafts key on a fixed sprint key. */
const MANUAL_KEY = 'manual';
const LAST_TEAM_KEY = 'retro:last-team';
const STATUS_POSITION_KEY = 'retro:status-position';
/** Remembers the chosen sprint per team, so a reload lands where you left. */
const lastSprintKey = (teamId: string) => `retro:last-sprint:${teamId}`;

/**
 * Drafts are per team *and* per sprint, so last sprint's retro is still there
 * when you switch back. Manual mode gets its own stable key.
 */
const storageKey = (teamId: string, sprintId: number | null) =>
  `retro:${teamId}:${sprintId ?? MANUAL_KEY}`;

interface Draft extends RetroState {
  sprint: string;
  recipients: string;
  titleTouched: boolean;
}

/** The editable body of the form, minus the team/sprint selection around it. */
interface FormValues {
  title: string;
  sprint: string;
  goals: Goal[];
  committed: string;
  completed: string;
  comments: string;
  pluses: string;
  improvements: string;
  recipients: string;
  titleTouched: boolean;
}

const emptyValues = (recipients: string): FormValues => ({
  title: '',
  sprint: '',
  goals: [],
  committed: '',
  completed: '',
  comments: '',
  pluses: '',
  improvements: '',
  recipients,
  titleTouched: false,
});

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
    // The form still works; drafts just don't survive a reload.
  }
}

function removeStore(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function loadDraft(teamId: string, sprintId: number | null): Draft | null {
  const raw = readStore(storageKey(teamId, sprintId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

/** True when a stored draft for this team+sprint holds anything typed. */
function draftHasContent(draft: Draft | null): boolean {
  if (!draft) return false;
  return (
    (draft.goals ?? []).some((goal) => String(goal?.text ?? '').trim() !== '') ||
    [draft.completed, draft.committed, draft.comments, draft.pluses, draft.improvements].some(
      (value) => String(value ?? '').trim() !== '',
    )
  );
}

/** A draft turned back into form values, with every field defended. */
function draftToValues(draft: Draft | null, team: TeamConfig): FormValues {
  const base = emptyValues(team.recipients.join(', '));
  if (!draft) return base;
  return {
    ...base,
    title: typeof draft.title === 'string' ? draft.title : '',
    sprint: typeof draft.sprint === 'string' ? draft.sprint : '',
    goals: Array.isArray(draft.goals)
      ? draft.goals
          .filter((goal): goal is Goal => !!goal && typeof goal.text === 'string')
          // Old drafts only carried 'done'/'wip'; normalizeStatus keeps them
          // loading unchanged and copes with anything hand-edited.
          .map((goal) => ({ text: goal.text, status: normalizeStatus(goal.status) }))
      : [],
    committed: draft.committed ?? '',
    completed: draft.completed ?? '',
    comments: draft.comments ?? '',
    pluses: draft.pluses ?? '',
    improvements: draft.improvements ?? '',
    recipients: draft.recipients ?? base.recipients,
    titleTouched: draft.titleTouched === true,
  };
}

export interface RetroFormProps {
  teams: TeamConfig[];
}

export function RetroForm({ teams }: RetroFormProps) {
  const [teamId, setTeamId] = React.useState(() => {
    const last = readStore(LAST_TEAM_KEY);
    if (last && teams.some((team) => team.id === last)) return last;
    return teams[0]?.id ?? '';
  });
  const team = teams.find((t) => t.id === teamId) ?? teams[0];

  const [sprintId, setSprintId] = React.useState<number | null>(null);
  const [sprints, setSprints] = React.useState<Sprint[]>([]);
  const [jiraStatus, setJiraStatus] = React.useState<{ text: string; warn: boolean }>({
    text: 'Loading sprints…',
    warn: false,
  });
  const [status, setStatus] = React.useState('');
  const [paste, setPaste] = React.useState('');
  /** Opened automatically when Jira fails — the paste box is then the way in. */
  const [pasteOpen, setPasteOpen] = React.useState(false);

  const [statusPosition, setStatusPositionState] = React.useState<StatusPosition>(() =>
    normalizeStatusPosition(readStore(STATUS_POSITION_KEY)),
  );

  const [values, setValues] = React.useState<FormValues>(() =>
    team ? draftToValues(loadDraft(team.id, null), team) : emptyValues(''),
  );

  const sprintsById = React.useMemo(
    () => new Map(sprints.map((sprint) => [sprint.id, sprint])),
    [sprints],
  );

  /**
   * Bumped on every team or sprint change so a slow in-flight response — sprint
   * list or velocity — can't land late and overwrite the form.
   */
  const loadToken = React.useRef(0);
  /** Mirrors of the current selection, readable from inside async work. */
  const teamIdRef = React.useRef(teamId);
  const sprintIdRef = React.useRef(sprintId);
  teamIdRef.current = teamId;
  sprintIdRef.current = sprintId;

  const statusTimer = React.useRef<number | undefined>(undefined);
  const flashStatus = React.useCallback((message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    if (message !== '') {
      statusTimer.current = window.setTimeout(() => setStatus(''), 4000);
    }
  }, []);
  React.useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  // ------------------------------------------------------------ persistence

  /**
   * Save on every change. Writing from an effect rather than from each handler
   * means there is exactly one place that can persist, so no edit path can
   * forget to — the original had `save()` sprinkled through fourteen handlers.
   */
  React.useEffect(() => {
    if (!team) return;
    const draft: Draft = {
      title: values.title,
      goals: values.goals,
      committed: values.committed,
      completed: values.completed,
      comments: values.comments,
      pluses: values.pluses,
      improvements: values.improvements,
      sprint: values.sprint,
      recipients: values.recipients,
      titleTouched: values.titleTouched,
      statusPosition,
    };
    writeStore(storageKey(team.id, sprintId), JSON.stringify(draft));
    writeStore(LAST_TEAM_KEY, team.id);
  }, [team, sprintId, values, statusPosition]);

  const setStatusPosition = (next: StatusPosition) => {
    setStatusPositionState(next);
    writeStore(STATUS_POSITION_KEY, next);
  };

  /** Apply the team's title template unless the user has typed their own. */
  const withTitle = React.useCallback(
    (next: FormValues): FormValues => {
      if (next.titleTouched || !team) return next;
      return { ...next, title: buildTitle(team.titleTemplate, next.sprint) };
    },
    [team],
  );

  const patch = React.useCallback(
    (fields: Partial<FormValues>) => setValues((prev) => withTitle({ ...prev, ...fields })),
    [withTitle],
  );

  // ------------------------------------------------------------------- jira

  const noteTokenExpired = React.useCallback(() => {
    setJiraStatus({ text: 'Jira token invalid or expired — enter values manually.', warn: true });
    setPasteOpen(true);
  }, []);

  /** Jira is unreachable: say so once, and open the manual way in. */
  const noteJiraFailed = React.useCallback((text: string) => {
    setJiraStatus({ text, warn: true });
    setPasteOpen(true);
  }, []);

  /** Velocity for one sprint, or null whenever it isn't available. */
  const loadVelocity = React.useCallback(
    async (forTeam: string, forSprint: number) => {
      try {
        const response = await fetch(
          `/api/velocity?team=${encodeURIComponent(forTeam)}&sprintId=${forSprint}`,
        );
        if (response.status === 401) {
          noteTokenExpired();
          return null;
        }
        const body = (await response.json()) as {
          available?: boolean;
          committed?: number;
          completed?: number;
        };
        if (body.available !== true) return null;
        // A malformed payload must not write "NaN" into the points fields.
        const committed = Number(body.committed);
        const completed = Number(body.completed);
        if (!Number.isFinite(committed) || !Number.isFinite(completed)) return null;
        return { committed, completed };
      } catch {
        // Velocity is best-effort by design: the points fields just stay put.
        return null;
      }
    },
    [noteTokenExpired],
  );

  /** Apply a sprint's Jira data to the form. */
  const applyPrefill = React.useCallback(
    async (sprint: Sprint, forTeam: string) => {
      const rows = splitGoals(sprint.goal ?? '');
      const number = sprintNumber(sprint.name);

      setValues((prev) =>
        withTitle({
          ...prev,
          ...(rows.length > 0
            ? { goals: rows.map((text) => ({ text, status: 'wip' as const })) }
            : {}),
          ...(number !== '' ? { sprint: number } : {}),
        }),
      );

      // Velocity is the one awaited step, so a team or sprint switch can land
      // while it is in flight. Snapshot what this prefill is for, and drop the
      // response if any of it has moved on — otherwise last sprint's points get
      // written over the sprint now on screen, and the save effect persists them.
      const token = loadToken.current;
      const velocity = await loadVelocity(forTeam, sprint.id);
      if (
        token !== loadToken.current ||
        teamIdRef.current !== forTeam ||
        sprintIdRef.current !== sprint.id
      ) {
        return;
      }

      if (velocity) {
        setValues((prev) => ({
          ...prev,
          committed: String(velocity.committed),
          completed: String(velocity.completed),
        }));
        setJiraStatus({
          text: `Prefilled ${rows.length} goal${rows.length === 1 ? '' : 's'} and points.`,
          warn: false,
        });
      } else {
        // Silent-but-labeled: say the numbers are missing, don't raise an error.
        setJiraStatus({
          text:
            rows.length > 0
              ? `Prefilled ${rows.length} goal${rows.length === 1 ? '' : 's'}. Points unavailable — type them in.`
              : 'This sprint has no goal text. Points unavailable — type them in.',
          warn: false,
        });
      }
    },
    [loadVelocity, withTitle],
  );

  /** Fill the sprint list for a team. Failure leaves manual mode intact. */
  const loadSprints = React.useCallback(
    async (forTeam: string) => {
      const token = ++loadToken.current;
      setSprints([]);
      setJiraStatus({ text: 'Loading sprints…', warn: false });

      let response: Response;
      try {
        response = await fetch(`/api/sprints?team=${encodeURIComponent(forTeam)}`);
      } catch {
        if (token === loadToken.current) {
          noteJiraFailed('Could not reach Jira — enter values manually.');
        }
        return;
      }
      // A team switch landed first; this response is stale.
      if (token !== loadToken.current) return;

      if (response.status === 401) {
        noteTokenExpired();
        return;
      }
      if (!response.ok) {
        noteJiraFailed('Jira sprints unavailable — enter values manually.');
        return;
      }

      let body: { sprints?: Sprint[]; defaultSprintId?: number | null };
      try {
        body = await response.json();
      } catch {
        noteJiraFailed('Jira sent an unreadable response — enter values manually.');
        return;
      }
      if (token !== loadToken.current) return;

      const list = Array.isArray(body.sprints) ? body.sprints : [];
      if (list.length === 0) {
        setJiraStatus({ text: 'No sprints on this board — enter values manually.', warn: false });
        setPasteOpen(true);
        return;
      }

      setSprints(list);

      // Prefer the sprint last used for this team; otherwise the server's
      // default (active sprint, else most recently closed).
      let selected = body.defaultSprintId ?? null;
      const remembered = Number(readStore(lastSprintKey(forTeam)));
      if (list.some((sprint) => sprint.id === remembered)) selected = remembered;

      setJiraStatus({ text: '', warn: false });
      selectSprintRef.current?.(selected, list, { silent: true });
    },
    [noteJiraFailed, noteTokenExpired],
  );

  /**
   * Handle a sprint selection: swap to that sprint's draft, then prefill from
   * Jira only when there is nothing to lose.
   *
   * Held in a ref because `loadSprints` calls it and it calls back into state
   * that `loadSprints` sets — a direct dependency would be circular.
   */
  const selectSprintRef = React.useRef<
    ((id: number | null, list: Sprint[], options?: { silent?: boolean }) => void) | null
  >(null);

  selectSprintRef.current = (id, list, options = {}) => {
    if (!team) return;

    setSprintId(id);
    sprintIdRef.current = id;
    if (id === null) removeStore(lastSprintKey(team.id));
    else writeStore(lastSprintKey(team.id), String(id));

    // Load whatever draft belongs to this team+sprint first.
    const draft = loadDraft(team.id, id);
    setValues(withTitle(draftToValues(draft, team)));

    if (id === null) {
      if (!options.silent) setJiraStatus({ text: 'Manual entry.', warn: false });
      return;
    }

    const sprint = list.find((s) => s.id === id);
    if (!sprint) return;

    if (draftHasContent(draft)) {
      // Respect the draft. Prefill stays one explicit click away.
      setJiraStatus({
        text: 'Saved draft restored. Use “Prefill from Jira” to replace it.',
        warn: false,
      });
      return;
    }

    void applyPrefill(sprint, team.id);
  };

  // Load sprints for the current team on mount and on every team change.
  React.useEffect(() => {
    if (!teamId) return;
    void loadSprints(teamId);
    // `loadSprints` is stable; re-running on its identity would refetch on
    // every status message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // ---------------------------------------------------------------- actions

  const state: RetroState = {
    title: values.title,
    goals: values.goals,
    completed: values.completed,
    committed: values.committed,
    comments: values.comments,
    pluses: values.pluses,
    improvements: values.improvements,
    statusPosition,
  };

  const plain = formatPlain(state);

  const copyOutput = async () => {
    if (plain === '') {
      flashStatus('Nothing to copy yet.');
      return;
    }
    const html = formatHtml(state);
    try {
      // Both flavours in one clipboard item: Apple Mail takes the HTML, Notes
      // and Slack take the plain text.
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      flashStatus('Copied.');
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        flashStatus('Copied as plain text.');
      } catch {
        flashStatus('Copy failed — select the text manually.');
      }
    }
  };

  const mailTeam = () => {
    if (plain === '') {
      flashStatus('Nothing to send yet.');
      return;
    }
    const recipients = values.recipients
      .split(/[,;]/)
      .map((address) => address.trim())
      .filter((address) => address.length > 0);
    window.location.href = buildMailto(recipients, values.title, plain);
  };

  const addSplitGoals = (text: string): boolean => {
    const rows = splitGoals(text);
    if (rows.length === 0) return false;
    patch({
      goals: [...values.goals, ...rows.map((row) => ({ text: row, status: 'wip' as const }))],
    });
    flashStatus(`Added ${rows.length} goal${rows.length === 1 ? '' : 's'}.`);
    return true;
  };

  const runPrefill = () => {
    const sprint = sprintId === null ? undefined : sprintsById.get(sprintId);
    if (!sprint || !team) {
      setJiraStatus({ text: 'Pick a Jira sprint first.', warn: false });
      return;
    }
    // This click supersedes any prefill still awaiting Jira.
    loadToken.current += 1;
    void applyPrefill(sprint, team.id);
  };

  const resetForm = () => {
    if (!team) return;
    removeStore(storageKey(team.id, sprintId));
    setValues(withTitle(emptyValues(team.recipients.join(', '))));
    flashStatus('Form reset.');
  };

  const draftIsDirty = draftHasContent(team ? loadDraft(team.id, sprintId) : null);

  // ------------------------------------------------------------------- view

  if (!team) return null;

  const sectionHeading = 'mb-5 text-xs font-semibold tracking-[0.12em] text-muted uppercase';
  const section = 'border-t border-rule py-8 first:border-t-0';
  const hint = 'mt-1.5 mb-0 text-xs text-muted';

  return (
    <>
      <section className={section} aria-labelledby="heading-details">
        <h2 id="heading-details" className={sectionHeading}>
          Details
        </h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="team">Team/Space</Label>
            <Select
              value={teamId}
              onValueChange={(next) => {
                // Reset to manual first so the draft restored below is the
                // manual one if the sprint list never arrives.
                loadToken.current += 1;
                setSprintId(null);
                setSprints([]);
                const nextTeam = teams.find((t) => t.id === next);
                if (nextTeam) setValues(draftToValues(loadDraft(next, null), nextTeam));
                setTeamId(next);
              }}
            >
              <SelectTrigger id="team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="jira-sprint">Sprint (from Jira)</Label>
            <Select
              value={sprintId === null ? MANUAL_KEY : String(sprintId)}
              onValueChange={(next) => {
                // Same invalidation as a team switch: any prefill still
                // awaiting Jira belongs to the sprint we just left.
                loadToken.current += 1;
                selectSprintRef.current?.(
                  next === MANUAL_KEY ? null : Number(next),
                  sprints,
                );
              }}
            >
              <SelectTrigger id="jira-sprint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL_KEY}>Manual entry</SelectItem>
                {sprints.map((sprint) => (
                  <SelectItem key={sprint.id} value={String(sprint.id)}>
                    {sprintLabel(sprint)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jiraStatus.text !== '' && (
              <p
                className={cn(hint, jiraStatus.warn && 'font-medium text-warn')}
                role="status"
                aria-live="polite"
              >
                {jiraStatus.text}
              </p>
            )}
          </div>
        </div>

        {/*
          The prefill button used to sit in a two-column grid cell with no label
          above it, so it floated half a line higher than everything else in the
          row. It gets its own full-width row now, aligned to the same left edge
          as every field on the page.
        */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ConfirmButton
            question="Replace the goals and points for this sprint with the values from Jira? Your notes are kept."
            confirmLabel="Replace"
            needsConfirm={draftIsDirty}
            onConfirm={runPrefill}
          >
            Prefill from Jira
          </ConfirmButton>
          <span className="text-xs text-muted">
            Refills goals and points from the selected sprint.
          </span>
        </div>

        {/*
          Title and sprint number are derived from the team template and the
          selected sprint, so in the normal flow nobody touches them. Folded
          away by default; still one click from being overridden.
        */}
        <Accordion type="single" collapsible className="mt-6 border-t border-rule [&_[data-slot=accordion-item]]:border-b-0">
          <AccordionItem value="title">
            <AccordionTrigger>Title and sprint number</AccordionTrigger>
            <AccordionContent className="grid gap-5 sm:grid-cols-[8rem_1fr]">
              <div>
                <Label htmlFor="sprint">Sprint number</Label>
                <Input
                  id="sprint"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="31"
                  value={values.sprint}
                  onChange={(event) => patch({ sprint: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  autoComplete="off"
                  value={values.title}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      title: event.target.value,
                      titleTouched: true,
                    }))
                  }
                />
                <p className={hint}>
                  Composed from the team template and sprint number. Edit it and it stays as
                  typed.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section className={section} aria-labelledby="heading-goals">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="heading-goals" className={cn(sectionHeading, 'mb-0')}>
            Goals
          </h2>
          {/*
            The position setting lives with the goals, next to what it changes,
            rather than in a settings panel three sections away.
          */}
          <fieldset className="m-0 flex items-center gap-2 border-0 p-0">
            <legend className="float-left mr-2 p-0 text-xs text-muted">Status sits</legend>
            {(['before', 'after'] as const).map((position) => (
              <Button
                key={position}
                size="xs"
                variant={statusPosition === position ? 'default' : 'quiet'}
                aria-pressed={statusPosition === position}
                onClick={() => setStatusPosition(position)}
              >
                {position === 'before' ? 'Before text' : 'After text'}
              </Button>
            ))}
          </fieldset>
        </div>

        <GoalList
          goals={values.goals}
          statusPosition={statusPosition}
          onChange={(goals) => patch({ goals })}
        />

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button
            variant="quiet"
            onClick={() => patch({ goals: [...values.goals, { text: '', status: 'wip' }] })}
          >
            Add goal
          </Button>
          <ConfirmButton
            question="Remove every goal row?"
            confirmLabel="Clear goals"
            needsConfirm={values.goals.length > 0}
            onConfirm={() => patch({ goals: [] })}
          >
            Clear goals
          </ConfirmButton>
        </div>

        {/*
          Closed by default — the normal flow prefills from Jira and never needs
          it — but opened automatically the moment Jira fails, because it is
          then the only way to get goals into the form.
        */}
        <Accordion
          type="single"
          collapsible
          className="mt-6 border-t border-rule [&_[data-slot=accordion-item]]:border-b-0"
          value={pasteOpen ? 'paste' : ''}
          onValueChange={(value) => setPasteOpen(value === 'paste')}
        >
          <AccordionItem value="paste">
            <AccordionTrigger>Paste goals</AccordionTrigger>
            <AccordionContent>
              <Textarea
                id="paste"
                value={paste}
                placeholder="Paste a list here — one per line, or separated by ; • - or 1. 2. 3."
                onChange={(event) => setPaste(event.target.value)}
                onPaste={(event) => {
                  // Pasting straight in splits immediately; the button is the
                  // fallback for people who type or edit before splitting.
                  const text = event.clipboardData?.getData('text/plain');
                  if (!text || text.trim() === '') return;
                  // Split first: if nothing usable comes out, don't swallow the
                  // paste — let it land in the box so the text isn't lost.
                  if (splitGoals(text).length === 0) return;
                  event.preventDefault();
                  addSplitGoals(text);
                }}
              />
              <div className="mt-2.5">
                <Button
                  variant="quiet"
                  onClick={() => {
                    if (addSplitGoals(paste)) setPaste('');
                    else flashStatus('Nothing to split.');
                  }}
                >
                  Split into rows
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section className={section} aria-labelledby="heading-points">
        <h2 id="heading-points" className={sectionHeading}>
          Points
        </h2>
        <div className="grid max-w-sm gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="committed">Commitment</Label>
            <Input
              id="committed"
              type="number"
              min={0}
              step={1}
              autoComplete="off"
              value={values.committed}
              onChange={(event) => patch({ committed: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="completed">Complete</Label>
            <Input
              id="completed"
              type="number"
              min={0}
              step={1}
              autoComplete="off"
              value={values.completed}
              onChange={(event) => patch({ completed: event.target.value })}
            />
          </div>
        </div>
      </section>

      <section className={section} aria-labelledby="heading-notes">
        <h2 id="heading-notes" className={sectionHeading}>
          Notes
        </h2>
        <div className="grid gap-7">
          {(
            [
              ['comments', 'Comments'],
              ['pluses', 'Pluses'],
              ['improvements', 'Improvements'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={key}>{label}</Label>
              <Textarea
                id={key}
                placeholder="One per line"
                value={values[key]}
                onChange={(event) => patch({ [key]: event.target.value })}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={section} aria-labelledby="heading-actions">
        <h2 id="heading-actions" className={sectionHeading}>
          Actions
        </h2>
        <div>
          <Label htmlFor="recipients">Recipients</Label>
          <Input
            id="recipients"
            autoComplete="off"
            placeholder="name@example.com, other@example.com"
            value={values.recipients}
            onChange={(event) => patch({ recipients: event.target.value })}
          />
          <p className={hint}>Comma-separated. Prefilled from the team config; edit freely.</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button variant="default" onClick={() => void copyOutput()}>
            Copy
          </Button>
          <Button variant="outline" onClick={mailTeam}>
            Mail team
          </Button>
          <ConfirmButton
            question="Clear the draft for this team and sprint?"
            confirmLabel="Reset"
            onConfirm={resetForm}
          >
            Reset form
          </ConfirmButton>
        </div>
        <p className="mt-3 mb-0 min-h-5 text-[0.8125rem] text-muted" role="status" aria-live="polite">
          {status}
        </p>
      </section>
    </>
  );
}
