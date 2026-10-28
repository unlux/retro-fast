import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { BauList } from '@/components/BauList';
import { GoalList } from '@/components/GoalList';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { normalizeBauItems, type BauItem } from '@/lib/bau';
import { buildPlanText, includeUnfinishedGoals, mergeGoalText, planLines, revisePushedPlan } from '@/lib/plan';
import { newGoal, type Goal } from '@/lib/format';
import { nextSprintName, type Sprint } from '@/lib/sprints';
import type { TeamConfig } from '@/lib/teams';

export interface PlanTabProps {
  team: TeamConfig;
  spaceName: string;
  future: Sprint[];
  latestName: string | null;
  bauItems: BauItem[];
  seedText: string;
  sourceSprintId: number | null;
  targetLoadState: 'loading' | 'ready' | 'error';
  targetLoadError: string;
  onRetry: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  step: number;
  onStepChange: (step: number) => void;
  boardUrl: string | null;
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Draft remains usable in memory. */ }
}

/** Mounted once on entering planning and keyed by Space in RetroForm. */
export function PlanTab({ team, spaceName, future, latestName, bauItems, seedText, sourceSprintId,
  targetLoadState, targetLoadError, onRetry, onRefresh,
  step, onStepChange, boardUrl }: PlanTabProps) {
  const importKey = `plan-imported:${team.id}:${sourceSprintId ?? 'manual'}`;
  const [carryover] = React.useState(() => {
    let imported: string[] = [];
    try {
      const saved = JSON.parse(read(importKey) ?? '[]');
      if (Array.isArray(saved)) imported = saved.filter(value => typeof value === 'string');
    } catch { /* Old or invalid metadata can be rebuilt. */ }
    const draft = read(`plan:${team.id}`) ?? '';
    const text = includeUnfinishedGoals(draft, seedText, imported);
    return { text, changed: text !== draft, imported: [...new Set([...imported, ...planLines(seedText)])] };
  });
  const [goals, setGoals] = React.useState<Goal[]>(() => planLines(carryover.text).map(text => newGoal(text)));
  const goalText = goals.map(goal => goal.text).join('\n');
  const [celebration, setCelebration] = React.useState(0);
  React.useEffect(() => {
    if (carryover.changed) {
      toast.success('Filled unfinished goals.', { id: `carryover:${team.id}` });
    }
    return () => { toast.dismiss(`carryover:${team.id}`); };
  }, [team.id, carryover]);
  const [bauDraft, setBauDraft] = React.useState<BauItem[]>(() => {
    try {
      const saved = read(`plan-bau:${team.id}`);
      return saved === null ? bauItems : normalizeBauItems(JSON.parse(saved));
    } catch { return bauItems; }
  });
  React.useEffect(() => save(`plan:${team.id}`, goalText), [team.id, goalText]);
  React.useEffect(() => save(importKey, JSON.stringify(carryover.imported)), [importKey, carryover]);
  React.useEffect(() => save(`plan-bau:${team.id}`, JSON.stringify(bauDraft)), [team.id, bauDraft]);

  // Jira's board order is authoritative; sprint IDs and names need not be sequential.
  const listedTarget = future.at(-1) ?? null;
  const [targetOverride, setTargetOverride] = React.useState<{ sprint: Sprint | null } | null>(null);
  const target = targetOverride ? targetOverride.sprint : listedTarget;
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState<{ sprint: Sprint; text: string } | null>(() => {
    try {
      const saved = JSON.parse(read(`plan-pushed:${team.id}`) ?? 'null');
      return saved && typeof saved.text === 'string' && Number.isInteger(saved.sprint?.id)
        && typeof saved.sprint?.goal === 'string' ? saved : null;
    } catch { return null; }
  });
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [mergeText, setMergeText] = React.useState('');
  const [reconcile, setReconcile] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const planText = buildPlanText(goalText, bauDraft);
  const finished = success !== null && success.text === planText &&
    success.sprint.id === target?.id && success.sprint.goal === target.goal;
  const ready = targetLoadState === 'ready';
  const combinedPlan = success?.sprint.id === target?.id && success?.sprint.goal === target?.goal
    ? revisePushedPlan(target?.goal ?? '', success?.text ?? '', planText)
    : mergeGoalText(target?.goal ?? '', planText, 'append');

  const push = async (goal: string) => {
    if (busyRef.current || !ready || goal.trim() === '') return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/push-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team: team.id, goal, expectedSprintId: target?.id ?? null,
          expectedGoal: target?.goal ?? '' }),
      });
      const body = await response.json();
      if (!alive.current) return;
      if (!response.ok) {
        if (response.status === 409 && 'sprint' in body) {
          setTargetOverride({ sprint: body.sprint });
          setMergeText(goal);
          setReconcile(true);
          setMergeOpen(true);
        }
        setError(body.error || 'Could not push the plan. Try again.');
        return;
      }
      setMergeOpen(false);
      setReconcile(false);
      setTargetOverride({ sprint: body.sprint });
      setSuccess({ sprint: body.sprint, text: planText });
      setCelebration(value => value + 1);
      save(`plan-pushed:${team.id}`, JSON.stringify({ sprint: body.sprint, text: planText }));
      // Refresh only metadata. Retro's reviewed outcomes and notes stay untouched.
      await onRefresh();
    } catch {
      if (alive.current) setError('Could not confirm the push. Retry to check Jira before writing again.');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const startPush = () => {
    if (reconcile) { setMergeOpen(true); return; }
    if (target?.goal.trim() && target.goal !== planText) {
      setMergeText(combinedPlan ?? target.goal);
      setReconcile(combinedPlan === null);
      setMergeOpen(true);
    } else {
      void push(planText);
    }
  };

  return <>
    <section hidden={step !== 7} className="py-7" aria-labelledby="heading-plan">
      <h2 id="heading-plan" tabIndex={-1} className="mb-5 text-sm font-semibold">Plan the next sprint</h2>
      <h3 className="mb-2 text-sm font-semibold">Goals</h3>
      <div id="plan-goals">
        <GoalList goals={goals} onChange={setGoals} showStatus={false} />
      </div>
      <Button variant="quiet" className="mt-4" onClick={() => setGoals(current => [...current, newGoal('')])}>Add goal</Button>
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold">BAU</h3>
        <BauList items={bauDraft} onItemsChange={setBauDraft} />
      </div>
    </section>

    <section hidden={step !== 8} className="py-7" aria-labelledby="heading-push">
      <h2 id="heading-push" tabIndex={-1} className="mb-5 text-sm font-semibold">{finished ? 'All done' : 'Push the plan to Jira'}</h2>
      {finished ? <>
        {celebration > 0 && <CompletionConfetti key={celebration} />}
        <p role="status" className="text-sm">Goals and BAU saved to {success.sprint.name}.</p>
        <p className="mt-3 text-sm">Go back to Jira to check the tickets and start the sprint when ready.</p>
        {boardUrl && <Button asChild className="mt-5"><a href={boardUrl} target="_blank" rel="noopener noreferrer">
          Open Jira <ExternalLink aria-hidden="true" /><span className="sr-only">Opens in a new tab</span>
        </a></Button>}
      </> : <>
        {!ready ? <div role="status" className="text-sm">
          {targetLoadState === 'loading' ? 'Loading sprints…' : targetLoadError || 'Could not load sprints.'}
          {targetLoadState === 'error' && <Button className="ml-3" onClick={() => { setTargetOverride(null); void onRetry(); }}>Retry</Button>}
        </div> : <p className="mb-4 text-sm">
          {target ? <>Target sprint: <strong>{target.name}</strong></> :
            <>No future sprint in {spaceName}. Pushing will create {nextSprintName(latestName) || 'Sprint 1'}.</>}
        </p>}
        <pre data-testid="plan-preview" className="mb-5 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-rule bg-canvas p-4 font-sans text-sm">{planText || 'No goals or BAU to push.'}</pre>
        <Button variant="default" disabled={busy || !ready || planText === ''} onClick={startPush}>
          {busy ? 'Pushing…' : 'Push to Jira'}
        </Button>
      </>}
    </section>

    <p role="alert" className="mb-3 text-sm text-warn">{error}</p>
    <div className="flex items-center justify-between gap-3 border-t border-rule py-5" data-print-hide>
      <Button variant="ghost" disabled={busy} onClick={() => onStepChange(step - 1)}>Back</Button>
      {step === 7 && <Button variant="default" onClick={() => {
        if (!planText) { setError('Add a goal or BAU item before continuing.'); return; }
        setError(''); onStepChange(8);
      }}>Continue</Button>}
      {step === 8 && finished && <Button variant="default" onClick={() => onStepChange(1)}>Back to sprints</Button>}
    </div>

    <Dialog open={mergeOpen} onOpenChange={open => { if (!busy) setMergeOpen(open); }}>
      <DialogContent aria-describedby="merge-description">
        <DialogTitle>{target?.name} already has goals</DialogTitle>
        <DialogDescription id="merge-description">Review the combined plan before saving.</DialogDescription>
        {reconcile && <div className="mt-4 text-sm">
          <p>Your edits are preserved below. Reconcile them with the current Jira goals and updated plan before pushing.</p>
          <h3 className="mt-3 font-semibold">Current Jira goals</h3>
          <pre data-testid="current-jira-goals" className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{target?.goal || 'No goals yet.'}</pre>
          <h3 className="mt-3 font-semibold">Updated plan</h3>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{planText}</pre>
        </div>}
        <Label htmlFor="merge-text" className="mt-5">What Jira will get</Label>
        <Textarea id="merge-text" value={mergeText} onChange={event => setMergeText(event.target.value)} className="min-h-48" disabled={busy} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => setMergeText(combinedPlan ?? target?.goal ?? '')}>Keep existing goals</Button>
          <Button disabled={busy} onClick={() => setMergeText(planText)}>Replace existing goals</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-warn">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setMergeOpen(false)}>Cancel</Button>
          <Button variant="default" disabled={busy || mergeText.trim() === ''} onClick={() => void push(mergeText)}>{busy ? 'Pushing…' : 'Push to Jira'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
