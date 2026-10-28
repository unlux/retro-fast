import { jiraFetch, type JiraConfig } from './jira';
import { listSprints, nextSprintName, isValidSprintName, type ListSprintsOptions, type Sprint } from './sprints';

export interface PlanPush {
  goal: string;
  expectedSprintId: number | null;
  expectedGoal: string;
}
export type PlanPushResult =
  | { ok: true; sprint: Sprint; created: boolean }
  | { ok: false; sprint: Sprint | null; message: string };

/** Re-read the board at write time. A changed target needs another user review. */
export async function pushPlan(config: JiraConfig, boardId: number, input: PlanPush,
  options: ListSprintsOptions = {}): Promise<PlanPushResult> {
  const listing = await listSprints(config, boardId, { ...options, requireComplete: true });
  const target = listing.future.at(-1) ?? null;

  // A lost success response is safe to retry, including a just-created sprint.
  if (target?.goal === input.goal) return { ok: true, sprint: target, created: false };

  if (target && (target.id !== input.expectedSprintId || target.goal !== input.expectedGoal)) {
    return { ok: false, sprint: target,
      message: `Jira changed. Review ${target.name} and push again.` };
  }
  if (!target && input.expectedSprintId !== null) {
    return { ok: false, sprint: null,
      message: 'That future sprint is no longer available. Review the new sprint before pushing.' };
  }

  if (target) {
    // Only a future sprint returned from this board is eligible for this write.
    await jiraFetch(config, `rest/agile/1.0/sprint/${target.id}`, {
      method: 'POST', body: { goal: input.goal }, fetchImpl: options.fetchImpl,
    });
    return { ok: true, sprint: { ...target, goal: input.goal }, created: false };
  }

  const suggested = nextSprintName(listing.latestName) || 'Sprint 1';
  const name = isValidSprintName(suggested) ? suggested : 'Next sprint';
  // Jira accepts a goal during creation. One write avoids an empty sprint if
  // a second network request fails between creating it and setting its goal.
  const created = await jiraFetch<Sprint>(config, 'rest/agile/1.0/sprint', {
    method: 'POST', body: { name, originBoardId: boardId, goal: input.goal },
    fetchImpl: options.fetchImpl,
  });
  if (!Number.isInteger(created?.id) || created.id <= 0) {
    // Do not repeat the create: the next request must list the board again.
    throw new Error('Jira did not confirm the created sprint.');
  }
  return { ok: true, created: true, sprint: { ...created, name: created.name || name,
    state: 'future', goal: input.goal } };
}
