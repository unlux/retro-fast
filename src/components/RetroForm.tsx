import * as React from 'react';
import { UserRoundCog } from 'lucide-react';

import { BauList } from '@/components/BauList';
import { ConfirmButton } from '@/components/ConfirmButton';
import { GoalList } from '@/components/GoalList';
import { PlanTab } from '@/components/PlanTab';
import { RecipientsDialog } from '@/components/RecipientsDialog';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { VelocityReportDialog } from '@/components/VelocityReportDialog';
import {
  buildMailto,
  buildTitle,
  formatHtml,
  formatPlain,
  formatUnfinishedGoals,
  newGoal,
  normalizeStatusPosition,
  withGoalIds,
  type Goal,
  type RetroState,
  type StatusPosition,
} from '@/lib/format';
import {
  mergeBauParse,
  normalizeBauChecks,
  normalizeBauItems,
  splitBauBlock,
  type BauChecks,
  type BauItem,
} from '@/lib/bau';
import { seedPlanFromGoals } from '@/lib/plan';
import { formatRecipients, parseRecipients } from '@/lib/recipients';
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
/** Managed mail recipients belong to the Space, not to one sprint. */
const recipientsKeyFor = (teamId: string) => `recipients:${teamId}`;

/**
 * The team's standing BAU list, keyed by team and **not** by sprint.
 *
 * That is the whole BAU persistence model in one line: the *items* are a
 * standing inventory the team curates over months, so they outlive every
 * sprint; the *ticks* are one fortnight's answers and live in that sprint's
 * draft below. Storing the list per sprint would mean retyping it every retro,
 * which is exactly the manual work this tool deletes.
 */
const bauKeyFor = (teamId: string) => `bau:${teamId}`;

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

/** The team's BAU list, or an empty one. */
function loadBauItems(teamId: string): BauItem[] {
  const raw = readStore(bauKeyFor(teamId));
  if (!raw) return [];
  try {
    return normalizeBauItems(JSON.parse(raw));
  } catch {
    return [];
  }
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
  /**
   * Which BAU items were done *this sprint*, keyed by item id.
   *
   * Part of the draft, unlike the item list itself: "did we do the podcast"
   * has a different answer every fortnight, so a new sprint starts with every
   * box clear rather than inheriting last sprint's — a stale tick reads as a
   * claim, which is worse than no answer.
   */
  bauChecks: BauChecks;
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
  bauChecks: {},
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

/** A draft turned back into form values, with every field defended. */
function draftToValues(draft: Draft | null, team: TeamConfig): FormValues {
  const managedRecipients = readStore(recipientsKeyFor(team.id));
  const base = emptyValues(
    managedRecipients ?? formatRecipients(team.recipients),
  );
  if (!draft) return base;
  return {
    ...base,
    title: typeof draft.title === 'string' ? draft.title : '',
    sprint: typeof draft.sprint === 'string' ? draft.sprint : '',
    // `withGoalIds` is the draft migration: it normalizes each status (old
    // drafts only carried 'done'/'wip') and mints an id for any goal saved
    // before ids existed, so a pre-existing retro loads rather than breaking.
    goals: withGoalIds(draft.goals),
    committed: draft.committed ?? '',
    completed: draft.completed ?? '',
    comments: draft.comments ?? '',
    pluses: draft.pluses ?? '',
    improvements: draft.improvements ?? '',
    // Once the boss manages the Space list, it becomes the source for every
    // sprint. Until then, an older draft's recipients remain compatible.
    recipients: managedRecipients ?? draft.recipients ?? base.recipients,
    titleTouched: draft.titleTouched === true,
    // Absent in every draft written before BAU existed, which is exactly the
    // "nothing ticked" state — so an old draft restores untouched.
    bauChecks: normalizeBauChecks(draft.bauChecks),
  };
}

/**
 * One numbered step of the ritual.
 *
 * The number is the point. Pete performs the same sequence every fortnight, in
 * the same order — end the sprint, read the report, check the goals and the
 * numbers, write the notes, send it — and a numbered list is how a ritual is
 * written down. The numeral sits in its own box at the left margin so the four
 * of them line up as a column down the page and the eye finds "where was I"
 * without reading a word.
 *
 * Defined at module scope, not inside `RetroForm`. A component declared in a
 * render body is a *new type* on every render, so React unmounts and remounts
 * its entire subtree each time any state changes — which here would blow away
 * the focus and the caret position in every field on the page on every
 * keystroke.
 */
function Step({
  n,
  title,
  id,
  printHide,
  children,
}: {
  n: number;
  title: string;
  id: string;
  printHide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-step=""
      className="relative border-t border-rule py-8 pl-10 before:absolute before:top-0 before:bottom-0 before:left-[0.6875rem] before:w-px before:bg-rule first:border-t-0 first:before:top-8 max-sm:pl-9"
      aria-labelledby={`heading-${id}`}
      {...(printHide ? { 'data-print-hide': true } : {})}
    >
      <h2
        id={`heading-${id}`}
        className="mb-5 flex min-h-6 items-center text-sm font-semibold text-ink"
      >
        <span
          aria-hidden="true"
          className="absolute left-0 z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand bg-brand-soft text-xs font-semibold text-brand [font-variant-numeric:tabular-nums]"
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
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
  /** Jira owns display names; config names keep the form usable offline. */
  const [spaceNames, setSpaceNames] = React.useState<Record<string, string>>({});
  const spaceName = team ? (spaceNames[team.id] ?? team.fallbackName) : '';

  const [sprintId, setSprintId] = React.useState<number | null>(null);
  const [sprints, setSprints] = React.useState<Sprint[]>([]);
  const [jiraStatus, setJiraStatus] = React.useState<{ text: string; warn: boolean }>({
    text: 'Loading sprints…',
    warn: false,
  });
  /**
   * Network state for the waits the user actually sees. Sprint goals already
   * arrive inside the selected sprint object; only the points need a second
   * request. Skeletons occupy the real controls' space while each wait runs.
   */
  const [sprintsLoading, setSprintsLoading] = React.useState(true);
  const [pointsFilling, setPointsFilling] = React.useState(false);
  /** True while the end-sprint POST is in flight. */
  const [ending, setEnding] = React.useState(false);
  /**
   * The Copy button confirms in place rather than only in the status line.
   *
   * The status line sits at the bottom of a long page; on a tall form the
   * button you just pressed is often the only thing you are looking at, so a
   * confirmation somewhere else is a confirmation you miss. The label swaps to
   * "Copied" for a beat and the button keeps its width, so the row does not
   * reflow underneath the pointer. The status line still says it too, for
   * screen readers and for the failure cases.
   */
  const [copied, setCopied] = React.useState(false);
  const copiedTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  /**
   * The carry-over copy confirms the same way, on its own flag: two buttons
   * that both say "Copied" at once would leave you unsure which one you hit.
   */
  const [carriedOver, setCarriedOver] = React.useState(false);
  const carriedOverTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(carriedOverTimer.current), []);

  const [status, setStatus] = React.useState('');
  const [paste, setPaste] = React.useState('');

  /*
   * The occasional panels and dialogs.
   *
   * Each of these used to be permanently on the page (or folded into an
   * accordion, which is the same thing with a lid). None of them is touched in
   * a normal retro: the title composes itself from the team template, goals
   * arrive from Jira, and recipients usually stay fixed. They remain out of
   * the main workflow until somebody asks to edit them.
   *
   * They are React state and nothing else. Deliberately NOT persisted: a draft
   * is the retro you typed, and "was the recipients field open last Tuesday" is
   * not part of it. Keeping them out of the draft also means an old draft
   * restores into the new layout unchanged, which is the whole compatibility
   * story.
   */
  /** Opened automatically when Jira fails — the paste box is then the way in. */
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [titleOpen, setTitleOpen] = React.useState(false);
  /** Recipient management opens from the icon segment beside Mail team. */
  const [recipientsOpen, setRecipientsOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);

  const [statusPosition, setStatusPositionState] = React.useState<StatusPosition>(() =>
    normalizeStatusPosition(readStore(STATUS_POSITION_KEY)),
  );

  const [values, setValues] = React.useState<FormValues>(() =>
    team ? draftToValues(loadDraft(team.id, null), team) : emptyValues(''),
  );

  /**
   * The team's standing BAU list. Team-scoped, sprint-independent, and stored
   * under its own key — see `bauKeyFor`. Editing it here (add, rename, remove)
   * changes what the team is asked about from the next retro onwards.
   */
  const [bauItems, setBauItems] = React.useState<BauItem[]>(() =>
    team ? loadBauItems(team.id) : [],
  );

  /**
   * Which tab is showing. Two jobs, one page: the retro writes up the sprint
   * that just ended, the plan sets up the one that has not started.
   *
   * Deliberately not persisted, for the same reason the spawned panels are
   * not: it is where you happen to be looking, not part of any draft. Retro is
   * always the landing tab, because that is the fortnightly ritual — planning
   * is the thing you sometimes do afterwards.
   */
  const [tab, setTab] = React.useState<'retro' | 'plan'>('retro');
  /** Future sprints and the newest name, for the Plan tab's target picker. */
  const [future, setFuture] = React.useState<Sprint[]>([]);
  const [latestName, setLatestName] = React.useState<string | null>(null);

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
  /**
   * The standing list, readable from `fillGoalsFromJira` without making it a
   * dependency. Filling goals must not re-run every time somebody ticks BAU.
   */
  const bauItemsRef = React.useRef(bauItems);
  bauItemsRef.current = bauItems;

  const statusTimer = React.useRef<number | undefined>(undefined);
  const flashStatus = React.useCallback((message: string) => {
    setStatus(message);
    window.clearTimeout(statusTimer.current);
    if (message !== '') {
      statusTimer.current = window.setTimeout(() => setStatus(''), 4000);
    }
  }, []);
  React.useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  // Load every configured Space name once so all picker options come from
  // Jira. A failed or missing entry keeps its checked-in fallback.
  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/spaces', { signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as {
          spaces?: Array<{ id?: unknown; name?: unknown }>;
        };
        if (!Array.isArray(body.spaces)) return;

        const known = new Set(teams.map((entry) => entry.id));
        const next: Record<string, string> = {};
        for (const entry of body.spaces) {
          if (
            typeof entry.id !== 'string' ||
            !known.has(entry.id) ||
            typeof entry.name !== 'string' ||
            entry.name.trim() === ''
          ) {
            continue;
          }
          next[entry.id] = entry.name.trim();
        }
        if (!controller.signal.aborted) setSpaceNames(next);
      } catch {
        // Jira names are optional presentation data. Config remains the fallback.
      }
    })();
    return () => controller.abort();
  }, [teams]);

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
      // Ticks travel with the sprint's draft; the item list does not.
      bauChecks: values.bauChecks,
    };
    writeStore(storageKey(team.id, sprintId), JSON.stringify(draft));
    writeStore(LAST_TEAM_KEY, team.id);
  }, [team, sprintId, values, statusPosition]);

  /**
   * The standing list saves separately, on its own key, keyed only by team.
   * Its own effect because its lifetime is different: it must survive a sprint
   * change, a form reset, and a draft being cleared.
   */
  React.useEffect(() => {
    if (!team) return;
    writeStore(bauKeyFor(team.id), JSON.stringify(bauItems));
  }, [team, bauItems]);

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

  /** Load one sprint's velocity without mutating any form fields. */
  const loadVelocity = React.useCallback(
    async (forTeam: string, forSprint: number) => {
      try {
        const response = await fetch(
          `/api/velocity?team=${encodeURIComponent(forTeam)}&sprintId=${forSprint}`,
        );
        if (response.status === 401) {
          return { kind: 'unauthorized' } as const;
        }
        if (!response.ok) return { kind: 'unavailable' } as const;
        const body = (await response.json()) as {
          available?: boolean;
          committed?: number;
          completed?: number;
        };
        if (body.available !== true) return { kind: 'unavailable' } as const;
        // A malformed payload must not write "NaN" into the points fields.
        const committed = Number(body.committed);
        const completed = Number(body.completed);
        if (!Number.isFinite(committed) || !Number.isFinite(completed)) {
          return { kind: 'unavailable' } as const;
        }
        return { kind: 'available', committed, completed } as const;
      } catch {
        // Velocity is best-effort by design: the points fields just stay put.
        return { kind: 'unavailable' } as const;
      }
    },
    [],
  );

  /** Replace only goals, BAU ticks, and the sprint-derived title fields. */
  const fillGoalsFromJira = React.useCallback(
    (sprint: Sprint, announce = true) => {
      /*
       * BAU comes out of the goal text *before* the splitter runs.
       *
       * The order is the whole trick. `splitGoals` strips checkbox markers into
       * goal rows, which is correct and load-bearing for the Marketing board —
       * its sprint goals genuinely are a checkbox list. So the BAU block is
       * lifted out first and only the remainder is split, which means a
       * checkbox line NOT under a "BAU" header still becomes a goal row exactly
       * as it always did.
       */
      const { rest, bau } = splitBauBlock(sprint.goal ?? '');
      const rows = splitGoals(rest);
      const number = sprintNumber(sprint.name);

      /*
       * Merge the parsed block into the team's standing list, and take this
       * sprint's ticks from it. Additive only: an item Jira did not mention is
       * kept, because the boss routinely omits what he did not touch and a
       * prefill must never delete months of curation.
       */
      let bauChecks: BauChecks | null = null;
      let bauAdded = 0;
      if (bau) {
        const merged = mergeBauParse(bauItemsRef.current, bau);
        setBauItems(merged.items);
        bauChecks = merged.checks;
        bauAdded = merged.added;
      }

      setValues((prev) =>
        withTitle({
          ...prev,
          goals: rows.map((text) => newGoal(text)),
          ...(number !== '' ? { sprint: number } : {}),
          // Only when the goal text actually carried a BAU block: a sprint
          // without one says nothing about the ticks, so they stay as typed.
          ...(bauChecks ? { bauChecks } : {}),
        }),
      );

      // Only mention BAU when the prefill actually grew the standing list —
      // recognising items already on it is the normal case and not news.
      const bauNote =
        bauAdded > 0 ? ` Added ${bauAdded} BAU item${bauAdded === 1 ? '' : 's'}.` : '';
      const goalNote =
        rows.length > 0
          ? `Filled ${rows.length} goal${rows.length === 1 ? '' : 's'} from Jira.`
          : 'This sprint has no goal text.';
      const summary = `${goalNote}${bauNote}`;
      if (announce) setJiraStatus({ text: summary, warn: false });
      return summary;
    },
    [withTitle],
  );

  /** Replace only Commitment and Complete from Jira's velocity snapshot. */
  const fillPointsFromJira = React.useCallback(
    async (sprint: Sprint, forTeam: string, goalSummary = '') => {
      const token = loadToken.current;
      setPointsFilling(true);
      const velocity = await loadVelocity(forTeam, sprint.id);
      if (
        token !== loadToken.current ||
        teamIdRef.current !== forTeam ||
        sprintIdRef.current !== sprint.id
      ) {
        return;
      }

      setPointsFilling(false);
      if (velocity.kind === 'unauthorized') {
        noteTokenExpired();
        return;
      }

      const prefix = goalSummary === '' ? '' : `${goalSummary} `;
      if (velocity.kind === 'available') {
        setValues((prev) => ({
          ...prev,
          committed: String(velocity.committed),
          completed: String(velocity.completed),
        }));
        setJiraStatus({
          text: `${prefix}${goalSummary === '' ? 'Filled points from Jira.' : 'Points filled.'}`,
          warn: false,
        });
      } else {
        setJiraStatus({
          text: `${prefix}Points unavailable. Type them in.`,
          warn: false,
        });
      }
    },
    [loadVelocity, noteTokenExpired],
  );

  /** Sprint selection runs the two isolated fills together. */
  const fillBothFromJira = React.useCallback(
    (sprint: Sprint, forTeam: string) => {
      const goalSummary = fillGoalsFromJira(sprint, false);
      void fillPointsFromJira(sprint, forTeam, goalSummary);
    },
    [fillGoalsFromJira, fillPointsFromJira],
  );

  /** Fill the sprint list for a team. Failure leaves manual mode intact. */
  const loadSprints = React.useCallback(
    async (forTeam: string) => {
      const token = ++loadToken.current;
      setPointsFilling(false);
      setSprints([]);
      setSprintsLoading(true);
      setJiraStatus({ text: 'Loading sprints…', warn: false });

      /**
       * Clear the skeleton, but only if this load is still the current one — a
       * stale response must not un-skeleton the load that superseded it.
       */
      const settle = () => {
        if (token === loadToken.current) setSprintsLoading(false);
      };

      let response: Response;
      try {
        response = await fetch(`/api/sprints?team=${encodeURIComponent(forTeam)}`);
      } catch {
        if (token === loadToken.current) {
          noteJiraFailed('Could not reach Jira — enter values manually.');
        }
        settle();
        return;
      }
      // A team switch landed first; this response is stale.
      if (token !== loadToken.current) return;

      if (response.status === 401) {
        noteTokenExpired();
        settle();
        return;
      }
      if (!response.ok) {
        noteJiraFailed('Jira sprints unavailable — enter values manually.');
        settle();
        return;
      }

      let body: {
        sprints?: Sprint[];
        defaultSprintId?: number | null;
        future?: Sprint[];
        latestName?: string | null;
      };
      try {
        body = await response.json();
      } catch {
        noteJiraFailed('Jira sent an unreadable response — enter values manually.');
        settle();
        return;
      }
      if (token !== loadToken.current) return;

      // The Plan tab's target list. Set before the early return below, so a
      // board with no closed sprints can still be planned into.
      setFuture(Array.isArray(body.future) ? body.future : []);
      setLatestName(typeof body.latestName === 'string' ? body.latestName : null);

      const list = Array.isArray(body.sprints) ? body.sprints : [];
      if (list.length === 0) {
        setJiraStatus({ text: 'No sprints on this board — enter values manually.', warn: false });
        setPasteOpen(true);
        settle();
        return;
      }

      setSprints(list);
      // Down before the selection below, so the picker is real by the time the
      // prefill it triggers starts drawing its own skeletons.
      settle();

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
   * Handle a sprint selection: restore that sprint's notes, then refresh both
   * Jira-owned slices. Goals and points are independent, but selection runs
   * both by default.
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
      setPointsFilling(false);
      if (!options.silent) setJiraStatus({ text: 'Manual entry.', warn: false });
      return;
    }

    const sprint = list.find((s) => s.id === id);
    if (!sprint) return;

    fillBothFromJira(sprint, team.id);
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
    bauItems,
    bauChecks: values.bauChecks,
  };

  const plain = formatPlain(state);

  /** Show "Copied" on the button itself for a beat. */
  const flashCopied = React.useCallback(() => {
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, []);

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
      flashCopied();
      flashStatus('Copied.');
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        flashCopied();
        flashStatus('Copied as plain text.');
      } catch {
        flashStatus('Copy failed — select the text manually.');
      }
    }
  };

  /**
   * The goals that did not land, as the next sprint's starting basis.
   *
   * Computed here rather than inside the handler because the button's disabled
   * state is the same question: with nothing carrying over there is nothing to
   * paste, and a button that can only fail should say so before it is pressed.
   */
  const unfinished = formatUnfinishedGoals(values.goals);

  /**
   * Plain text only, deliberately. This one goes into Jira's sprint-goal field,
   * which is a plain single-line-ish text input — an HTML flavour would at best
   * be ignored and at worst arrive as markup.
   */
  const copyUnfinished = async () => {
    if (unfinished === '') {
      flashStatus('No unfinished goals.');
      return;
    }
    try {
      await navigator.clipboard.writeText(unfinished);
      setCarriedOver(true);
      window.clearTimeout(carriedOverTimer.current);
      carriedOverTimer.current = window.setTimeout(() => setCarriedOver(false), 1600);
      flashStatus('Copied unfinished goals.');
    } catch {
      flashStatus('Copy failed — select the text manually.');
    }
  };

  const mailTeam = () => {
    if (plain === '') {
      flashStatus('Nothing to send yet.');
      return;
    }
    const recipients = parseRecipients(values.recipients);
    window.location.href = buildMailto(recipients, values.title, plain);
  };

  const addSplitGoals = (text: string): boolean => {
    const rows = splitGoals(text);
    if (rows.length === 0) return false;
    patch({ goals: [...values.goals, ...rows.map((row) => newGoal(row))] });
    flashStatus(`Added ${rows.length} goal${rows.length === 1 ? '' : 's'}.`);
    return true;
  };

  /** The sprint currently selected in the picker, if it is a Jira one. */
  const selectedSprint = sprintId === null ? undefined : sprintsById.get(sprintId);
  /** End-sprint is offered only for a sprint Jira says is running right now. */
  const canEndSprint = selectedSprint?.state === 'active';

  const runGoalsPrefill = () => {
    const sprint = selectedSprint;
    if (!sprint || !team) {
      setJiraStatus({ text: 'Pick a Jira sprint first.', warn: false });
      return;
    }
    fillGoalsFromJira(sprint);
  };

  const runPointsPrefill = () => {
    const sprint = selectedSprint;
    if (!sprint || !team) {
      setJiraStatus({ text: 'Pick a Jira sprint first.', warn: false });
      return;
    }
    void fillPointsFromJira(sprint, team.id);
  };

  /**
   * Close the selected sprint in Jira, then reload around the result.
   *
   * The server re-checks everything this function assumes (team, board
   * membership, active state) before it writes, so a stale picker here costs a
   * 400, not a wrongly-closed sprint. On success the sprint list is refetched
   * so the just-closed sprint comes back with `state: 'closed'` — and, because
   * Jira only computes a velocity snapshot at close, with its Commitment and
   * Complete numbers now available to prefill.
   */
  const endSprint = async () => {
    if (!team || !selectedSprint || ending) return;
    const closedId = selectedSprint.id;

    setEnding(true);
    setJiraStatus({ text: `Closing ${selectedSprint.name} in Jira…`, warn: false });

    try {
      const response = await fetch('/api/end-sprint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team: team.id, sprintId: closedId }),
      });

      if (!response.ok) {
        // Surface Jira's own reason. 403 in particular is actionable: it means
        // the token's user lacks the "Manage sprints" permission.
        let message = 'Could not end the sprint.';
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === 'string' && body.error !== '') message = body.error;
        } catch {
          /* keep the generic message */
        }
        setJiraStatus({ text: message, warn: true });
        return;
      }

      flashStatus('Sprint closed in Jira.');

      // Refetch so the picker reflects Jira, then land on the sprint we just
      // closed. `loadSprints` selects the board default (now the next active
      // sprint, or the newest closed one), so the selection is redirected to
      // the closed sprint explicitly once the list is back.
      writeStore(lastSprintKey(team.id), String(closedId));
      await loadSprints(team.id);

      // The report is the next thing Pete looks at, every single time: closing
      // the sprint is what makes Jira compute the snapshot, so this is the
      // first moment the numbers exist. Opening it here is the "end → see the
      // report right here" step, rather than sending him to Jira and back.
      setReportOpen(true);
    } catch {
      setJiraStatus({ text: 'Could not reach the server to end the sprint.', warn: true });
    } finally {
      setEnding(false);
    }
  };

  /**
   * Clear this team+sprint's draft.
   *
   * `emptyValues` carries `bauChecks: {}`, so the ticks go with the draft they
   * belong to. The standing BAU *list* deliberately survives: it is not part of
   * this retro, it is the team's inventory, and rebuilding it by hand because
   * somebody reset one sprint's form would be the exact opposite of the point.
   */
  const resetForm = () => {
    if (!team) return;
    removeStore(storageKey(team.id, sprintId));
    setValues(
      withTitle(
        emptyValues(
          readStore(recipientsKeyFor(team.id)) ?? formatRecipients(team.recipients),
        ),
      ),
    );
    flashStatus('Form reset.');
  };

  // ------------------------------------------------------------------- view

  if (!team) return null;

  /*
   * Three sizes, one job each — the page had two different caption sizes doing
   * the same work, which is what made the small type read as unconsidered.
   *
   *   15px  body: what you type, and what you read back.
   *   13px  caption: labels, hints, helper text — anything that is a sentence.
   *   12px  eyebrow: uppercase letterspaced step headings ONLY. Reserving the
   *         smallest size for the one non-prose role is what keeps the headings
   *         feeling like rules on a form rather than just small text.
   */
  const hint = 'mt-1.5 mb-0 text-[0.8125rem] text-muted';
  /** Helper prose set beside or beneath a control; same voice as `hint`. */
  const helper = 'text-[0.8125rem] text-muted';

  /**
   * A spawn button: the small text control that puts an occasional panel on the
   * page. Quieter than a `quiet` Button — no border at all — because it must
   * read as an offer rather than as one more thing on the list of things to do.
   */
  const spawnButton =
    'inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[0.8125rem] font-medium text-brand underline decoration-brand/40 underline-offset-4 outline-none transition-colors duration-[--duration-form] ease-[--ease-form] hover:text-brand-hover hover:decoration-brand-hover';

  /**
   * The panel a spawn button opens. A hairline top rule and the same gutter as
   * everything else, so a spawned field sits in the form's rhythm rather than
   * looking bolted on.
   */
  const spawnPanel =
    'mt-4 rounded-[var(--radius-surface)] border border-rule bg-canvas p-4';

  /**
   * Shared workflow navigation. Space is context for both jobs, so its picker
   * must stay outside the tab panels. The underlined tabs keep Retro and Plan
   * as peer workflows beneath that same Jira Space.
   */
  const tabs = [
    { id: 'retro', label: 'Retro' },
    { id: 'plan', label: 'Plan' },
  ] as const;

  const workflowNavigation = (
    <div
      data-workflow-navigation
      className="grid gap-x-8 border-b border-rule pt-5 sm:grid-cols-[minmax(12rem,20rem)_1fr] sm:items-end"
      data-print-hide
    >
      <div className="pb-4">
        <Label htmlFor="team">Space</Label>
        <Select
          value={teamId}
          onValueChange={(next) => {
            // Reset to manual first so the draft restored below is the manual
            // one if the sprint list never arrives.
            loadToken.current += 1;
            setPointsFilling(false);
            setSprintId(null);
            setSprints([]);
            setFuture([]);
            setLatestName(null);
            const nextTeam = teams.find((entry) => entry.id === next);
            if (nextTeam) setValues(draftToValues(loadDraft(next, null), nextTeam));
            setBauItems(loadBauItems(next));
            setTeamId(next);
          }}
        >
          <SelectTrigger id="team">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teams.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {spaceNames[option.id] ?? option.fallbackName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        role="tablist"
        aria-label="Retro or plan"
        className="flex min-h-10 items-end gap-6"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setTab(tab === 'retro' ? 'plan' : 'retro');
        }}
      >
        {tabs.map((entry) => {
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tab-${entry.id}`}
              aria-selected={active}
              aria-controls={`panel-${entry.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(entry.id)}
              className={cn(
                'relative -mb-px cursor-pointer border-0 border-b-2 bg-transparent px-0 pt-0 pb-2.5',
                'text-[0.8125rem] tracking-[0.02em] outline-none',
                'transition-[color,border-color] duration-[--duration-form] ease-[--ease-form]',
                active
                  ? 'border-b-brand font-semibold text-brand'
                  : 'border-b-transparent text-muted hover:text-ink',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {workflowNavigation}

      {/*
        Both panels stay mounted and the inactive one is hidden with `hidden`
        rather than unmounted. Switching tabs must not throw away a
        half-composed plan or reset the retro's spawned panels, and a remount
        would also refetch the sprint list on every switch.
      */}
      <div
        role="tabpanel"
        id="panel-retro"
        aria-labelledby="tab-retro"
        hidden={tab !== 'retro'}
      >
      {/*
        ─────────────────────────────────────────────────────────────────────
        1 — Sprint. Pick the sprint, close an active one when ready, or inspect
        the team's report at any time. Space is shared navigation above both
        tabs. All Jira machinery stays out of the printed letter.
      */}
      <Step n={1} id="sprint" title="Sprint" printHide>
        <div className="max-w-[40rem]">
          <div>
            <Label htmlFor="jira-sprint">Sprint (from Jira)</Label>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="min-w-[16rem] flex-1 max-sm:min-w-full">
                {/*
                  While the list is in flight the picker is a skeleton of exactly
                  the trigger's height (h-9), so the row below it never moves when
                  the real control arrives.
                */}
                {sprintsLoading ? (
                  <div aria-busy="true">
                    <Skeleton className="h-9 w-full" data-testid="skeleton-sprint-picker" />
                  </div>
                ) : (
                  <Select
                    value={sprintId === null ? MANUAL_KEY : String(sprintId)}
                    onValueChange={(next) => {
                      // Same invalidation as a team switch: any points request
                      // still awaiting Jira belongs to the sprint we just left.
                      loadToken.current += 1;
                      setPointsFilling(false);
                      selectSprintRef.current?.(next === MANUAL_KEY ? null : Number(next), sprints);
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
                )}
              </div>

              {canEndSprint && selectedSprint && (
                <ConfirmButton
                  variant="default"
                  question={`Have you checked your Jira board first? Ending ${selectedSprint.name} closes it for the whole team and moves unfinished issues to the backlog.`}
                  confirmLabel="End sprint"
                  disabled={ending}
                  onConfirm={() => void endSprint()}
                >
                  {ending ? 'Ending sprint…' : 'End sprint'}
                </ConfirmButton>
              )}
            </div>
            {/*
              A warning here gets the same oxblood left rule as the token-expiry
              banner at the top of the page, so the form has one way of saying
              "something is wrong" instead of two. Ordinary progress messages
              stay plain grey hints — they are not warnings and must not look
              like one. `min-h-*` holds the line's space either way, so the
              message appearing does not nudge the section below it.
            */}
            <p
              className={cn(
                hint,
                'min-h-[1.125rem]',
                jiraStatus.warn &&
                  'rounded-[var(--radius-control)] bg-warn-soft px-2 py-1 font-medium text-warn',
              )}
              role="status"
              aria-live="polite"
            >
              {jiraStatus.text}
            </p>
          </div>
        </div>

        {/* Reports are available independently of sprint selection. */}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="quiet" onClick={() => setReportOpen(true)}>
            View report
          </Button>

          <span className={helper}>
            {canEndSprint
              ? 'The report opens automatically after the sprint closes.'
              : 'Open Jira velocity history at any time.'}
          </span>
        </div>

        {/*
          Title and sprint number compose themselves from the team template and
          the selected sprint, so in the normal flow nobody touches them. They
          used to be an accordion — which still costs a full-width row with a
          chevron on every retro to say "there is something folded here". Now
          there is one small text button, and the fields exist only once asked
          for.
        */}
        {titleOpen ? (
          <div className={spawnPanel}>
            <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
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
                  autoFocus
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
            </div>
            <button type="button" className={cn(spawnButton, 'mt-4')} onClick={() => setTitleOpen(false)}>
              Done
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <button type="button" className={spawnButton} onClick={() => setTitleOpen(true)}>
              Edit title
            </button>
            {/*
              The current title shown as quiet text beside the button: the point
              of folding a field away is that you can still see its value, or
              you have hidden information rather than chrome.
            */}
            {values.title !== '' && (
              <span className={cn(helper, 'ml-2.5')}>{values.title}</span>
            )}
          </div>
        )}
      </Step>

      {/*
        ─────────────────────────────────────────────────────────────────────
        2 — Goals. The list, and the three-state toggles. This is the part Pete
        actually walks down, so it is the part with nothing folded in front of
        it.
      */}
      <Step n={2} id="goals" title="Goals">
        <div className="-mt-1 mb-4 flex flex-wrap items-baseline justify-between gap-3">
          {/*
            The position setting lives with the goals, next to what it changes,
            rather than in a settings panel three sections away.
          */}
          <fieldset className="m-0 flex items-center gap-2 border-0 p-0" data-print-hide>
            <legend className={cn(helper, 'float-left mr-2 p-0')}>Status sits</legend>
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

          <div data-print-hide>
            <ConfirmButton
              question="Replace the sprint goals and BAU ticks with this sprint's Jira goal text?"
              confirmLabel="Replace goals"
              needsConfirm={
                values.goals.some((goal) => goal.text.trim() !== '') ||
                Object.keys(values.bauChecks).length > 0
              }
              disabled={sprintsLoading || selectedSprint === undefined}
              onConfirm={runGoalsPrefill}
            >
              Fill goals from Jira
            </ConfirmButton>
          </div>
        </div>

        {/*
          While the sprint list loads, goal rows hold the page's shape. Jira
          includes goal text in that list response, so no second goal-loading
          state is needed after selection.
        */}
        {sprintsLoading ? (
          // Mirrors GoalList's own row box exactly — `flex items-center
          // gap-2.5 py-1.5` around an h-8 control — so swapping the real list
          // in changes nothing about the height.
          <ul className="m-0 list-none p-0" aria-busy="true" data-testid="skeleton-goals">
            {Array.from({ length: Math.max(values.goals.length, 3) }).map((_, index) => (
              <li key={index} className="flex items-center gap-2.5 py-1.5">
                <Skeleton className="h-8 w-[4.5rem] shrink-0" />
                <Skeleton className="h-8 flex-1" />
                <Skeleton className="size-8 shrink-0" />
              </li>
            ))}
          </ul>
        ) : (
          <GoalList
            goals={values.goals}
            statusPosition={statusPosition}
            onChange={(goals) => patch({ goals })}
          />
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2.5" data-print-hide>
          <Button variant="quiet" onClick={() => patch({ goals: [...values.goals, newGoal('')] })}>
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
          Paste is the fallback path — the normal flow fills from Jira and never
          reaches it — so it is spawned rather than folded. It still opens
          itself the moment Jira fails, because it is then the only way to get
          goals into the form at all, and a spawn button somebody has to notice
          is not good enough when the automatic path is gone.
        */}
        <div className="mt-4" data-print-hide>
          {pasteOpen ? (
            <div className={spawnPanel}>
              <Label htmlFor="paste">Paste goals</Label>
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
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <Button
                  variant="quiet"
                  onClick={() => {
                    if (addSplitGoals(paste)) setPaste('');
                    else flashStatus('Nothing to split.');
                  }}
                >
                  Split into rows
                </Button>
                <button type="button" className={spawnButton} onClick={() => setPasteOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={spawnButton} onClick={() => setPasteOpen(true)}>
              Paste goals
            </button>
          )}
        </div>

        {/*
          BAU is the final part of Goals: these rows describe work just like
          sprint goals do, but their text persists for the Space while the
          ticks belong only to this sprint.
        */}
        <div
          className="mt-7 border-t border-rule pt-6"
          role="group"
          aria-labelledby="bau-label"
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p id="bau-label" className="m-0 text-[0.8125rem] font-semibold text-ink">
              Repeatable goals
            </p>
            <span className={helper}>BAU</span>
          </div>
          <BauList
            items={bauItems}
            checks={values.bauChecks}
            onItemsChange={setBauItems}
            onChecksChange={(bauChecks) => patch({ bauChecks })}
          />
        </div>
      </Step>

      {/*
        ─────────────────────────────────────────────────────────────────────
        3 — Numbers & notes. The two point fields and the three prose boxes were
        two separate sections; they are one step because they are one sitting —
        you read the numbers off the report and write about them straight after.
      */}
      <Step n={3} id="notes" title="Numbers & notes">
        <div className="-mt-1 mb-4 flex justify-end" data-print-hide>
          <ConfirmButton
            question="Replace Commitment and Complete with Jira's points for this sprint?"
            confirmLabel="Replace points"
            needsConfirm={values.committed.trim() !== '' || values.completed.trim() !== ''}
            disabled={pointsFilling || sprintsLoading || selectedSprint === undefined}
            onConfirm={runPointsPrefill}
          >
            {pointsFilling ? 'Filling points…' : 'Fill points from Jira'}
          </ConfirmButton>
        </div>

        {/*
          Points require their own velocity request, so the two inputs become
          skeletons of the same height while it runs. Labels stay: they are not
          loading, and blanking them would make the section unreadable.

          Two short number fields, sized to the numbers they hold rather than
          stretched across half the page — a 3-digit points field 180px wide is
          mostly empty paper. Fixed columns keep the two the same width whatever
          the viewport, so they read as a pair.
        */}
        <div
          className="grid gap-5 [grid-template-columns:repeat(2,7rem)] max-sm:[grid-template-columns:repeat(2,minmax(0,1fr))]"
          {...(pointsFilling ? { 'aria-busy': 'true', 'data-testid': 'skeleton-points' } : {})}
        >
          <div>
            <Label htmlFor="committed">Commitment</Label>
            {pointsFilling ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="committed"
                type="number"
                min={0}
                step={1}
                autoComplete="off"
                value={values.committed}
                onChange={(event) => patch({ committed: event.target.value })}
              />
            )}
          </div>
          <div>
            <Label htmlFor="completed">Complete</Label>
            {pointsFilling ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Input
                id="completed"
                type="number"
                min={0}
                step={1}
                autoComplete="off"
                value={values.completed}
                onChange={(event) => patch({ completed: event.target.value })}
              />
            )}
          </div>
        </div>

        <div className="mt-7 grid gap-7">
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
      </Step>

      {/*
        ─────────────────────────────────────────────────────────────────────
        4 — Send. Copy, mail, and the recipients behind an affordance. All of
        this is ways of *sending* the retro, which is exactly what printing it
        instead replaces, so the whole step leaves the printed page.
      */}
      <Step n={4} id="send" title="Send" printHide>
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            Fixed width so swapping "Copy" for "Copied" cannot shuffle the two
            buttons beside it — the confirmation would then move the thing you
            are looking at, which is the one thing it must not do.
          */}
          <Button
            variant="default"
            className="w-24"
            onClick={() => void copyOutput()}
            // The label is the state, so it has to be announced as one.
            aria-live="polite"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <div className="inline-flex" role="group" aria-label="Mail team">
            <Button
              variant="outline"
              className="rounded-r-none border-r border-r-rule px-4"
              onClick={mailTeam}
            >
              Mail team
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="-ml-px w-10 rounded-l-none border-l border-l-rule"
              aria-label="Manage mail recipients"
              title="Manage mail recipients"
              onClick={() => setRecipientsOpen(true)}
            >
              <UserRoundCog aria-hidden="true" />
            </Button>
          </div>
          {/*
            Carry-over, not send: this is the one action in the row aimed at
            the *next* sprint rather than at this retro's letter, so it takes
            the quiet weight — grey until hovered — and sits after the two
            things the boss does every time. Fixed width for the same reason
            Copy has one: the label swaps and must not shuffle the row.
          */}
          <Button
            variant="quiet"
            className="w-52"
            onClick={() => void copyUnfinished()}
            disabled={unfinished === ''}
            aria-live="polite"
          >
            {carriedOver ? 'Copied' : 'Copy unfinished goals'}
          </Button>
          <ConfirmButton
            question="Clear the draft for this team and sprint?"
            confirmLabel="Reset"
            onConfirm={resetForm}
          >
            Reset form
          </ConfirmButton>
        </div>

        <p className="mt-4 mb-0 min-h-5 text-[0.8125rem] text-muted" role="status" aria-live="polite">
          {status}
        </p>
      </Step>
      </div>

      {/*
        ─────────────────────────────────────────────────────────────────────
        The Plan tab. Same team, same BAU list, opposite direction: it writes
        next sprint's goal instead of reading last sprint's.

        `seedText` is the retro's unfinished goals — the same computation as
        "Copy unfinished goals", so the two can never disagree about what is
        carrying over.
      */}
      <div
        role="tabpanel"
        id="panel-plan"
        aria-labelledby="tab-plan"
        hidden={tab !== 'plan'}
        className="pt-8"
        data-print-hide
      >
        <PlanTab
          team={team}
          spaceName={spaceName}
          future={future}
          latestName={latestName}
          bauItems={bauItems}
          seedText={seedPlanFromGoals(values.goals)}
          loading={sprintsLoading}
          onRefresh={() => loadSprints(team.id)}
        />
      </div>

      {/*
        The report. Mounted always so `reportOpen` can be flipped from the end-
        sprint flow as well as from the button; it fetches nothing until it is
        actually opened.
      */}
      <VelocityReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        teamId={team.id}
        teamName={spaceName}
        selectedSprintId={sprintId}
      />

      <RecipientsDialog
        open={recipientsOpen}
        onOpenChange={setRecipientsOpen}
        value={values.recipients}
        onChange={(recipients) => {
          patch({ recipients });
          writeStore(recipientsKeyFor(team.id), recipients);
        }}
      />
    </>
  );
}
