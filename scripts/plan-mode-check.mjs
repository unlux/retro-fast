/**
 * Browser regression check for the Plan workflow's state and safety contracts.
 *
 * Usage: node scripts/plan-mode-check.mjs [--url <url>]
 * The app server must already be running. All Jira routes are intercepted;
 * this script never reads from or writes to a real board.
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex === -1 ? 'http://127.0.0.1:4321/' : args[urlIndex + 1];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let marketingFails = true;
let goalWrites = 0;
const rexGoals = new Map([
  [33, 'Existing Jira goal'],
  [34, ''],
]);
let delayNextWrite = false;
let releaseWrite;
let markDelayedWriteStarted;
const delayedWriteStarted = new Promise((resolve) => (markDelayedWriteStarted = resolve));

await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('plan:rex', 'Existing plan');
  localStorage.setItem('plan:skillion-labs', 'Labs draft');
});

await page.route('**/api/spaces', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      spaces: [
        { id: 'rex', name: 'Rex Original' },
        { id: 'skillion-labs', name: 'Skillion Labs Original' },
        { id: 'marketing', name: 'Marketing Original' },
      ],
    }),
  }),
);

await page.route('**/api/sprints*', (route) => {
  const team = new URL(route.request().url()).searchParams.get('team');
  if (team === 'marketing' && marketingFails) {
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  }

  const active = {
    id: team === 'rex' ? 32 : team === 'skillion-labs' ? 12 : 8,
    name:
      team === 'rex'
        ? 'Rex Sprint 32'
        : team === 'skillion-labs'
          ? 'Labs Sprint 12'
          : 'Marketing Sprint 8',
    state: 'active',
    goal: 'Carry this',
    startDate: null,
    endDate: null,
    completeDate: null,
  };

  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      sprints: [active],
      defaultSprintId: active.id,
      future:
        team === 'rex'
          ? [
              {
                id: 33,
                name: 'Rex Sprint 33',
                state: 'future',
                goal: rexGoals.get(33),
                startDate: null,
                endDate: null,
                completeDate: null,
              },
              {
                id: 34,
                name: 'Rex Sprint 34',
                state: 'future',
                goal: rexGoals.get(34),
                startDate: null,
                endDate: null,
                completeDate: null,
              },
            ]
          : [],
      latestName: active.name,
    }),
  });
});

await page.route('**/api/velocity*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ available: true, committed: 13, completed: 8 }),
  }),
);

await page.route('**/api/set-goal', async (route) => {
  goalWrites += 1;
  const body = JSON.parse(route.request().postData() ?? '{}');

  if (delayNextWrite) {
    markDelayedWriteStarted();
    await new Promise((resolve) => {
      releaseWrite = resolve;
    });
  }

  rexGoals.set(body.sprintId, body.goal);
  try {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  } catch {
    // The Space switch intentionally aborts the delayed browser request.
  }
});

const chooseSpace = async (name) => {
  await page.locator('#team').click();
  await page.getByRole('option', { name }).click();
};

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#jira-sprint');
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByText('Fills the box with unfinished goals from Rex Sprint 32.').waitFor();

  // Shell copy and browser title must describe the workflow that is visible.
  assert.equal(await page.locator('h1:visible').textContent(), 'Sprint plan');
  assert.equal(await page.title(), 'Sprint plan');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );


  // Replacing typed work is confirmed, with focus on the safe action.
  const planGoals = page.locator('#plan-goals');
  await page.getByRole('button', { name: 'Seed from retro' }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Cancel');
  await page.keyboard.press('Enter');
  assert.equal(await planGoals.inputValue(), 'Existing plan');

  await page.getByRole('button', { name: 'Seed from retro' }).click();
  await page.getByRole('button', { name: 'Replace goals' }).click();
  assert.equal(await planGoals.inputValue(), 'Carry this');

  // An edited merge payload is written once, then protected from a repeat append.
  await page.getByRole('button', { name: 'Push to Jira' }).click();
  const mergeDialog = page.getByRole('dialog');
  const sentMerge = 'Existing Jira goal\n\nCarry this\n\nBoss note';
  await mergeDialog.locator('#merge-text').fill(sentMerge);
  await mergeDialog.getByRole('button', { name: 'Push to Jira' }).click();
  const pushed = page.getByRole('button', { name: 'Already pushed' });
  await pushed.waitFor();
  assert.equal(await pushed.isDisabled(), true);
  assert.equal(goalWrites, 1);
  assert.equal(rexGoals.get(33), sentMerge);

  // Arrow/Home/End navigation changes both selection and keyboard focus.
  await page.getByRole('tab', { name: 'Plan' }).focus();
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Retro' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-retro');
  assert.equal(await page.locator('h1:visible').textContent(), 'Sprint retro');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-plan');

  // A Space gets its own saved draft and its own transient create state.
  await planGoals.fill('Second plan');
  await page.locator('#plan-target').click();
  await page.getByRole('option', { name: 'Rex Sprint 34' }).click();
  delayNextWrite = true;
  await page.getByRole('button', { name: 'Push to Jira' }).click();
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await delayedWriteStarted;
  assert.equal(goalWrites, 2);
  await chooseSpace('Skillion Labs Original');
  releaseWrite();
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: 'Create sprint' }).waitFor();
  assert.equal(await planGoals.inputValue(), 'Labs draft');
  assert.equal(await page.getByText('Pushed to Rex Sprint 34 in Jira.').count(), 0);
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const newSprintName = page.locator('#plan-new-sprint');
  await newSprintName.waitFor();
  assert.equal(await newSprintName.evaluate((node) => document.activeElement === node), false);

  // A Jira outage must offer Retry, never pretend there is no future sprint.
  await chooseSpace('Marketing Original');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Retry' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Create sprint' }).count(), 0);
  assert.equal(await page.locator('#plan-new-sprint').count(), 0);
  await page.getByText('Nothing unfinished in this retro draft to carry over.').waitFor();

  marketingFails = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: 'Create sprint' }).waitFor();

  console.log('Plan mode browser contracts pass.');
} finally {
  await browser.close();
}
