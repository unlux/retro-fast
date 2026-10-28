import * as React from 'react';
import { ExternalLink, UserRoundCog } from 'lucide-react';

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
import { VelocityReport } from '@/components/VelocityReport';
import { Toaster, toast } from 'sonner';
import {
  buildMailto,
  buildTitle,
  formatHtml,
  formatPlain,
  newGoal,
  STATUS_LABEL,
  withGoalIds,
  type Goal,
  type RetroState,
  type StatusPosition,
} from '@/lib/format';
import {
  bauKey,
  mergeBauParse,
  newBauItem,
  normalizeBauChecks,
  normalizeBauItems,
  splitBauBlock,
  type BauChecks,
  type BauItem,
} from '@/lib/bau';
import { seedPlanFromGoals } from '@/lib/plan';
import { formatRecipients, parseRecipients, resolveRecipients } from '@/lib/recipients';
import { splitGoals } from '@/lib/split-goals';
import { sprintLabel, sprintNumber, type Sprint } from '@/lib/sprints';
import type { TeamConfig } from '@/lib/teams';
import { cn } from '@/lib/utils';

/** Manual mode has no Jira sprint id, so drafts key on a fixed sprint key. */
const MANUAL_KEY = 'manual';
const LAST_TEAM_KEY = 'retro:last-team';
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
  const base = emptyValues(resolveRecipients(managedRecipients, team.recipients));
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
    titleTouched: draft.titleTouched === true,
    // Absent in every draft written before BAU existed, which is exactly the
    // "nothing ticked" state — so an old draft restores untouched.
    bauChecks: normalizeBauChecks(draft.bauChecks),
  };
}

/** Each step stays mounted so navigating preserves field state. */
function Step({
  n,
  title,
  id,
  printHide,
  active,
  children,
}: {
  n: number;
  title: string;
  id: string;
  printHide?: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-step={n}
      hidden={!active}
      className="py-7"
      aria-labelledby={`heading-${id}`}
      {...(printHide ? { 'data-print-hide': true } : {})}
    >
      <h2
        id={`heading-${id}`}
        tabIndex={-1}
        className="mb-5 flex min-h-6 items-center text-sm font-semibold text-ink"
      >
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
  const [boardUrl, setBoardUrl] = React.useState<string | null>(null);
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
  /** Sprint whose Jira velocity snapshot could not supply point totals. */
  const [pointsUnavailableSprintId, setPointsUnavailableSprintId] = React.useState<number | null>(
    null,
  );
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

  const statusPosition: StatusPosition = 'before';

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
   * Ids of BAU items that just landed (from a fill or a "move to BAU" click),
   * kept only long enough to wash their rows — the section sits below the
   * goals, so arrivals need a visible trace where the eye actually is not.
   */
  const [freshBauIds, setFreshBauIds] = React.useState<ReadonlySet<string>>(new Set());
  const freshBauTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (freshBauTimer.current) clearTimeout(freshBauTimer.current);
    },
    [],
  );
  const flashBauItems = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFreshBauIds(new Set(ids));
    if (freshBauTimer.current) clearTimeout(freshBauTimer.current);
    freshBauTimer.current = setTimeout(() => setFreshBauIds(new Set()), 2500);
  }, []);

  /** Navigation is separate from the per-sprint draft. */
  const [step, setStep] = React.useState(1);
  const [stepError, setStepError] = React.useState('');
  const [checkingSprint, setCheckingSprint] = React.useState(false);
  const headingIds = ['sprint', 'complete', 'report', 'goals', 'notes', 'send', 'plan', 'push'];
  const goToStep = (next: number) => {
    setStepError('');
    setStep(next);
    if (next === 5 && selectedSprint && team) {
      void fillPointsFromJira(selectedSprint, team.id);
    }
    window.requestAnimationFrame(() => {
      const heading = document.getElementById(`heading-${headingIds[next - 1]}`);
      heading?.focus();
      heading?.scrollIntoView({ block: 'start' });
    });
  };
  /** Future sprints and the newest name for planning. */
  const [future, setFuture] = React.useState<Sprint[]>([]);
  const [latestName, setLatestName] = React.useState<string | null>(null);
  const [targetLoadState, setTargetLoadState] = React.useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [targetLoadError, setTargetLoadError] = React.useState('');

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

  /**
   * Reclassify a goal row as standing work: the row leaves the goal list and
   * its text joins the Space's BAU list (unless already on it, by the same
   * folded key the prefill dedupes on). The escape hatch for spellings of the
   * BAU section the parser does not recognize — repair is one click.
   */
  const moveGoalToBau = React.useCallback(
    (index: number) => {
      const goal = values.goals[index];
      if (!goal) return;
      patch({ goals: values.goals.filter((_, i) => i !== index) });
      const text = goal.text.trim();
      if (text === '') return;
      const key = bauKey(text);
      const existing = bauItems.find((item) => bauKey(item.text) === key);
      if (existing) {
        flashBauItems([existing.id]);
        return;
      }
      const item = newBauItem(text);
      setBauItems([...bauItems, item]);
      flashBauItems([item.id]);
    },
    [values.goals, bauItems, patch, flashBauItems],
  );

  /**
   * The return leg: a BAU item goes back to being a goal row. Its tick goes
   * with it — a goal has a status control instead — and it leaves the
   * standing list, so the next sprint stops asking about it.
   */
  const moveBauToGoal = React.useCallback(
    (index: number) => {
      const item = bauItems[index];
      if (!item) return;
      setBauItems(bauItems.filter((_, i) => i !== index));
      const checks = { ...values.bauChecks };
      delete checks[item.id];
      const text = item.text.trim();
      patch({
        bauChecks: checks,
        ...(text !== '' ? { goals: [...values.goals, newGoal(text)] } : {}),
      });
    },
    [bauItems, values.bauChecks, values.goals, patch],
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
        // New items are appended, so everything past the old length is new.
        flashBauItems(merged.items.slice(bauItemsRef.current.length).map((item) => item.id));
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

      // Say what happened to BAU whenever the goal text carried a block. The
      // section lives below the goals, so a silent merge reads as "nothing
      // happened" even when six items just landed on the standing list.
      const bauNote = bau
        ? ` Matched ${bau.items.length} BAU item${bau.items.length === 1 ? '' : 's'}${
            bauAdded > 0 ? `, ${bauAdded} new` : ''
          }.`
        : '';
      const goalNote =
        rows.length > 0
          ? `Filled ${rows.length} goal${rows.length === 1 ? '' : 's'} from Jira.`
          : 'This sprint has no goal text.';
      const summary = `${goalNote}${bauNote}`;
      if (announce) setJiraStatus({ text: summary, warn: false });
      return summary;
    },
    [withTitle, flashBauItems],
  );

  /** Replace only Commitment and Complete from Jira's velocity snapshot. */
  const fillPointsFromJira = React.useCallback(
    async (sprint: Sprint, forTeam: string, goalSummary = '') => {
      const token = loadToken.current;
      setPointsUnavailableSprintId(null);
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
        setPointsUnavailableSprintId(sprint.id);
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
    async (forTeam: string, preserveDraft = false) => {
      const token = ++loadToken.current;
      setPointsFilling(false);
      setPointsUnavailableSprintId(null);
      if (!preserveDraft) {
        setSprints([]);
        setBoardUrl(null);
      }
      setSprintsLoading(true);
      setTargetLoadState('loading');
      setTargetLoadError('');
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
          setTargetLoadState('error');
          setTargetLoadError('Could not load future sprints from Jira. Check the connection and retry.');
        }
        settle();
        return;
      }
      // A team switch landed first; this response is stale.
      if (token !== loadToken.current) return;

      if (response.status === 401) {
        noteTokenExpired();
        setTargetLoadState('error');
        setTargetLoadError('Jira credentials are invalid or expired. Rotate them, then retry.');
        settle();
        return;
      }
      if (!response.ok) {
        noteJiraFailed('Jira sprints unavailable — enter values manually.');
        setTargetLoadState('error');
        setTargetLoadError('Jira sprints are unavailable. Retry before creating or updating a sprint.');
        settle();
        return;
      }

      let body: {
        boardUrl?: string;
        sprints?: Sprint[];
        defaultSprintId?: number | null;
        future?: Sprint[];
        latestName?: string | null;
      };
      try {
        body = await response.json();
      } catch {
        if (token === loadToken.current) {
          noteJiraFailed('Jira sent an unreadable response — enter values manually.');
          setTargetLoadState('error');
          setTargetLoadError(
            'Jira returned an unreadable sprint list. Retry before making changes.',
          );
        }
        settle();
        return;
      }
      if (token !== loadToken.current) return;

      setBoardUrl(typeof body.boardUrl === 'string' ? body.boardUrl : null);

      // The Plan tab's target list. Set before the early return below, so a
      // board with no closed sprints can still be planned into.
      setFuture(Array.isArray(body.future) ? body.future : []);
      setLatestName(typeof body.latestName === 'string' ? body.latestName : null);
      setTargetLoadState('ready');
      setTargetLoadError('');

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
      if (!preserveDraft) selectSprintRef.current?.(selected, list, { silent: true });
      return list;
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
      setPointsUnavailableSprintId(null);
      if (!options.silent) setJiraStatus({ text: 'Manual entry.', warn: false });
      return;
    }

    const sprint = list.find((s) => s.id === id);
    if (!sprint) return;

    // A saved review is user work. Refreshing Jira must not reset its choices.
    if (!draft) fillBothFromJira(sprint, team.id);
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
  const showActivePointsNotice =
    selectedSprint?.state === 'active' &&
    pointsUnavailableSprintId === selectedSprint.id &&
    values.committed.trim() === '' &&
    values.completed.trim() === '';

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
   * Forget this browser's mail recipients for the Space, so the checked-in
   * `config/teams.json` list applies again. The override is only ever the
   * dialog's own key, so nothing else about the draft is touched.
   */
  const resetRecipients = () => {
    if (!team) return;
    removeStore(recipientsKeyFor(team.id));
    patch({ recipients: formatRecipients(team.recipients) });
  };

  const continueStep = async () => {
    if (step >= 4 && step <= 6) {
      const missing = values.goals.findIndex(goal => goal.text.trim() !== '' && goal.status === 'unreviewed');
      if (missing !== -1) {
        if (step !== 4) goToStep(4);
        setStepError('Choose Done, WIP, or Not done for each goal.');
        document.querySelector<HTMLElement>(`[aria-label="Goal ${missing + 1}: Done"]`)?.focus();
        return;
      }
    }
    if (step === 2 && sprintId !== null) {
      setCheckingSprint(true);
      const list = await loadSprints(team.id, true);
      const refreshed = list?.find(sprint => sprint.id === sprintId);
      if (refreshed?.state !== 'closed') {
        setCheckingSprint(false);
        setStepError(list ? 'The sprint is still active. Complete it in Jira, then continue.' : 'Could not check Jira. Try again.');
        return;
      }
      // Closing produces the velocity snapshot. Fetch it before starting the retro.
      // A saved closed-sprint draft keeps manually edited totals on repeat visits.
      if (selectedSprint?.state !== 'closed' || values.committed === '' || values.completed === '') {
        await fillPointsFromJira(refreshed, team.id);
      }
      setCheckingSprint(false);
    }
    goToStep(step + 1);
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
    'inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[0.8125rem] font-medium text-brand underline decoration-brand/40 underline-offset-4 outline-none transition-colors duration-(--duration-form) ease-(--ease-form) hover:text-brand-hover hover:decoration-brand-hover';

  /**
   * The panel a spawn button opens. A hairline top rule and the same gutter as
   * everything else, so a spawned field sits in the form's rhythm rather than
   * looking bolted on.
   */
  const spawnPanel =
    'mt-4 rounded-[var(--radius-surface)] border border-rule bg-canvas p-4';

  return (
    <>
      <Toaster position="top-center" closeButton toastOptions={{ duration: 3500 }} />
      <div className="border-b border-rule py-5" data-print-hide>
        <div className="flex items-center justify-between gap-4 text-[0.8125rem]">
          <span>Step {step} of 8</span>
          <span className="truncate text-muted">{step > 1 ? `${spaceName} / ${selectedSprint?.name ?? values.title}` : ''}</span>
        </div>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className={cn('h-1 flex-1 rounded-full', index < step ? 'bg-brand' : 'bg-rule')} />
          ))}
        </div>
      </div>
      <Step n={1} active={step === 1} id="sprint" title="Choose a sprint" printHide>
      <div className="mb-6 grid gap-2">
        <Label htmlFor="team" className="m-0 shrink-0 text-muted">
          Space
        </Label>
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
            setTargetLoadState('loading');
            setTargetLoadError('');
            const nextTeam = teams.find((entry) => entry.id === next);
            if (nextTeam) setValues(draftToValues(loadDraft(next, null), nextTeam));
            setBauItems(loadBauItems(next));
            setTeamId(next);
            setStepError('');
          }}
        >
          <SelectTrigger id="team" className="w-full">
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
        <div>
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
      <Step n={2} active={step === 2} id="complete" title="Complete the sprint in Jira" printHide>
        {selectedSprint?.state === 'closed' ? (
          <p className="text-sm">{selectedSprint.name} is completed.</p>
        ) : selectedSprint ? (
          <>
            <p className="mb-5 text-sm">Complete {selectedSprint.name} in Jira and choose where its unfinished tickets go.</p>
            {boardUrl && <Button asChild variant="outline" className="h-auto min-h-10 whitespace-normal">
              <a href={boardUrl} target="_blank" rel="noopener noreferrer">
                Open Jira to complete sprint <ExternalLink aria-hidden="true" />
                <span className="sr-only">Opens in a new tab</span>
              </a>
            </Button>}
            <p className="mt-4 text-sm text-muted">When you return, Continue checks that the sprint is completed.</p>
            {import.meta.env.DEV && <div className="mt-5">
              <Button variant="outline" disabled={checkingSprint} onClick={() => {
                goToStep(3);
                toast.info('Sprint close simulated. Jira is unchanged.');
              }}>Simulate Sprint Close</Button>
              <p className="mt-2 text-sm text-muted">Preview the remaining steps. Final report numbers may be unavailable until the sprint closes in Jira.</p>
            </div>}
          </>
        ) : (
          <p className="text-sm">This is a manual retro. Complete the sprint in Jira before continuing.</p>
        )}
      </Step>

      <Step n={3} active={step === 3} id="report" title="View report" printHide>
        <VelocityReport active={step === 3} teamId={team.id} teamName={spaceName} selectedSprintId={sprintId} />
      </Step>

      <Step n={4} active={step === 4} id="goals" title="Review goals and BAU">
        <div className="-mt-1 mb-4 flex flex-wrap items-baseline justify-between gap-3">
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
            onMoveToBau={moveGoalToBau}
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

        <div className="mt-8 border-t border-rule pt-6">
          <h3 className="mb-4 text-sm font-semibold">BAU</h3>
          <BauList
            items={bauItems}
            checks={values.bauChecks}
            onItemsChange={setBauItems}
            onChecksChange={(bauChecks) => patch({ bauChecks })}
            highlightIds={freshBauIds}
            onMoveToGoal={moveBauToGoal}
          />
        </div>
      </Step>

      {/*
        ─────────────────────────────────────────────────────────────────────
        3 — Numbers & notes. The two point fields and the three prose boxes were
        two separate sections; they are one step because they are one sitting —
        you read the numbers off the report and write about them straight after.
      */}
      <Step n={5} active={step === 5} id="notes" title="Numbers and notes">
        <div aria-label="Reviewed goals and BAU" className="mb-7 grid gap-6 border-b border-rule pb-6 sm:grid-cols-2" data-testid="review-summary">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Goals</h3>
            <ul className="space-y-2 text-sm">
              {values.goals.filter(goal => goal.text.trim()).map((goal, index) => (
                <li key={goal.id ?? index} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-xs font-semibold">{STATUS_LABEL[goal.status]}</span>
                  <span className="min-w-0 break-words">{goal.text}</span>
                </li>
              ))}
            </ul>
            {!values.goals.some(goal => goal.text.trim()) && <p className="text-sm text-muted">No goals.</p>}
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold">BAU</h3>
            <ul className="space-y-2 text-sm">
              {bauItems.filter(item => item.text.trim()).map(item => (
                <li key={item.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-xs font-semibold">{values.bauChecks[item.id] ? 'Done' : 'Not done'}</span>
                  <span className="min-w-0 break-words">{item.text}</span>
                </li>
              ))}
            </ul>
            {!bauItems.some(item => item.text.trim()) && <p className="text-sm text-muted">No BAU items.</p>}
          </div>
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
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div
            className="grid gap-5 [grid-template-columns:repeat(2,7rem)] max-sm:w-full max-sm:[grid-template-columns:repeat(2,minmax(0,1fr))]"
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

          <div data-print-hide>
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
        </div>

        {showActivePointsNotice ? (
          <p
            className="mt-2.5 rounded-[var(--radius-control)] border-l-2 border-brand bg-brand-soft px-3 py-2 text-[0.8125rem] text-ink"
            role="status"
            aria-live="polite"
            data-print-hide
          >
            Points for the active sprint are not available from Jira yet.
          </p>
        ) : null}

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
      <Step n={6} active={step === 6} id="send" title="Send the retro" printHide>
        <pre className="mb-6 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-rule bg-canvas p-4 font-sans text-sm" data-testid="retro-preview">{plain}</pre>
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            Fixed width so swapping "Copy" for "Copied" cannot shuffle the two
            buttons beside it — the confirmation would then move the thing you
            are looking at, which is the one thing it must not do.
          */}
          <Button
            variant="outline"
            className="w-24"
            onClick={() => void copyOutput()}
            // The label is the state, so it has to be announced as one.
            aria-live="polite"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <div className="inline-flex" role="group" aria-label="Mail team">
            <Button
              variant="default"
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
        </div>

        <p className="mt-4 text-[0.8125rem] text-muted">Mail team opens your email app. Send the message there, then continue.</p>
        <p className="mt-4 mb-0 min-h-5 text-[0.8125rem] text-muted" role="status" aria-live="polite">
          {status}
        </p>
      </Step>
      {step >= 7 && <PlanTab
        key={`${team.id}:${sprintId ?? 'manual'}`}
        team={team}
        spaceName={spaceName}
        future={future}
        latestName={latestName}
        bauItems={bauItems}
        seedText={seedPlanFromGoals(values.goals)}
        sourceSprintId={sprintId}
        targetLoadState={targetLoadState}
        targetLoadError={targetLoadError}
        onRetry={() => loadSprints(team.id, true).then(() => {})}
        onRefresh={() => loadSprints(team.id, true).then(() => {})}
        step={step}
        onStepChange={goToStep}
        boardUrl={boardUrl}
      />}

      {step < 7 && <div className="border-t border-rule py-5" data-print-hide>
        <p role="alert" className="mb-3 text-sm text-warn">{stepError}</p>
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" disabled={step === 1 || checkingSprint} onClick={() => goToStep(step - 1)}>Back</Button>
          <Button variant={step === 6 ? 'outline' : 'default'} disabled={sprintsLoading || pointsFilling || checkingSprint} onClick={() => void continueStep()}>
            {checkingSprint ? 'Checking Jira…' : 'Continue'}
          </Button>
        </div>
      </div>}

      <RecipientsDialog
        open={recipientsOpen}
        onOpenChange={setRecipientsOpen}
        value={values.recipients}
        onChange={(recipients) => {
          patch({ recipients });
          writeStore(recipientsKeyFor(team.id), recipients);
        }}
        onReset={resetRecipients}
        canReset={values.recipients !== formatRecipients(team.recipients)}
      />
    </>
  );
}
