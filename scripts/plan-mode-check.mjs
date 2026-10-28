/** Guided workflow regression. All Jira reads and writes use in-browser fixtures.
 * CLI: node scripts/plan-mode-check.mjs --url http://localhost:4321
 * T3 preview: inject --fixture-script before hydration; evaluate --browser-script.
 */
import { chromium } from 'playwright';

function installFixture() {
  localStorage.setItem('retro:last-team', 'rex');
  localStorage.setItem('retro:last-sprint:marketing', '40');
  const sprint = (id, name, state, goal = '') => ({ id, name, state, goal,
    startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-14T00:00:00Z', completeDate: null });
  window.retroFixture = {
    closed: false, failRead: false, writes: [], velocityReads: 0,
    future: [sprint(100, 'Pilot Sprint 2', 'future'), sprint(45, 'Pilot Sprint 3', 'future')],
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const f = window.retroFixture;
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname === '/api/spaces') return Response.json({ spaces: [] });
    if (url.pathname === '/api/velocity-report') return Response.json({ available: f.closed, series: [{ sprintId: 40, name: 'Pilot Sprint 0', committed: 3, completed: 2 }, { sprintId: 41, name: 'Pilot Sprint 1', committed: 8, completed: 5 }] });
    if (url.pathname === '/api/velocity') { f.velocityReads++; return Response.json({ available: f.closed, committed: 8, completed: 5 }); }
    if (url.pathname === '/api/sprints') {
      if (f.failRead) return Response.json({ error: 'Fixture read failure' }, { status: 503 });
      return Response.json({ sprints: [sprint(41, 'Pilot Sprint 1', f.closed ? 'closed' : 'active', 'Ship sign-in\nFinish exports\n\nBAU\n- [ ] Support\n- [ ] Reporting\n- [ ] Maintenance')],
        future: f.future, defaultSprintId: 41, latestName: 'Pilot Sprint 3',
        boardUrl: 'https://example.atlassian.net/secure/RapidBoard.jspa?rapidView=66&view=detail' });
    }
    if (url.pathname === '/api/push-plan') {
      const body = JSON.parse(init.body);
      f.writes.push(body);
      let target = f.future.at(-1);
      if (target && (target.id !== body.expectedSprintId || target.goal !== body.expectedGoal) && target.goal !== body.goal) {
        return Response.json({ error: 'Jira changed. Review the target and push again.', sprint: target }, { status: 409 });
      }
      if (!target) { target = sprint(46, 'Pilot Sprint 4', 'future'); f.future.push(target); }
      target.goal = body.goal;
      return Response.json({ ok: true, sprint: target });
    }
    throw new Error(`Unexpected API call: ${url.pathname}`);
  };
}

async function runChecks() {
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const wait = async condition => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for workflow');
  };
  const visible = e => e && e.getClientRects().length > 0;
  const button = text => { const scope = [...document.querySelectorAll('[role="dialog"]')].find(visible) ?? document; return [...scope.querySelectorAll('button')].find(e => visible(e) && e.textContent.trim() === text); };
  const click = async text => { await wait(() => button(text) && !button(text).disabled); const b = button(text); if (!b || b.disabled) throw new Error(`Unavailable button: ${text}`); b.click(); await new Promise(r => setTimeout(r, 40)); };
  const heading = text => [...document.querySelectorAll('h2')].some(e => visible(e) && e.textContent === text);
  const fill = (id, value) => {
    const node = document.getElementById(id);
    const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const reorderDown = async (label, keyboard = false) => {
    const handle = [...document.querySelectorAll('button')].find(e => visible(e) && e.getAttribute('aria-label') === `Reorder ${label}`);
    handle.scrollIntoView({ block: 'center' });
    if (keyboard) {
      handle.focus();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    } else {
      const from = handle.getBoundingClientRect();
      const to = handle.closest('li').nextElementSibling.getBoundingClientRect();
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      handle.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 6, clientY: y, buttons: 1, bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: to.y + to.height / 2, buttons: 1, bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: to.y + to.height / 2, button: 0, bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 80));
  };
  await wait(() => button('Continue') && !button('Continue').disabled);
  check(heading('Choose a sprint'), 'Starts at sprint selection');
  check(document.getElementById('team').textContent.includes('Skillion Marketing'), 'Marketing is the default despite a remembered space');
  check(!document.body.textContent.includes('Edit title'), 'Title editing is removed');
  await click('Continue');
  check(heading('Complete the sprint in Jira'), 'Complete the sprint before starting the retro');
  await click('Continue');
  check(heading('Complete the sprint in Jira'), 'Active sprint cannot be treated as closed');
  window.retroFixture.failRead = true;
  await click('Continue');
  check(heading('Complete the sprint in Jira'), 'Failed Jira check stays on completion step');
  window.retroFixture.failRead = false;
  window.retroFixture.closed = true;
  await click('Continue');
  check(heading('View report'), 'Step 3 is the report');
  await wait(() => document.querySelector('[data-step="3"] table'));
  check(!document.querySelector('[role="dialog"]') && document.querySelector('[data-step="3"] table').textContent.includes('Pilot Sprint 1'), 'Report renders inline after completion');
  const chartBar = document.querySelector('[data-step="3"] svg [role="button"]');
  chartBar.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await wait(() => document.querySelector('[data-step="3"] tbody tr').classList.contains('bg-brand-soft'));
  check(true, 'Hovering an earlier sprint highlights its table row');
  chartBar.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  await click('Continue');
  check(heading('Review goals and BAU'), 'Goals follow the report');
  check(!!button('Fill goals and BAU from Jira'), 'Jira fill names both goals and BAU');
  check(button('Paste goals').parentElement === button('Clear goals').parentElement && button('Paste goals').dataset.variant === button('Clear goals').dataset.variant, 'Paste and Clear share a row and button style');
  check(!document.querySelector('[aria-label*="to BAU"], [aria-label*="back to the goal list"]'), 'Goal and BAU conversion buttons are removed');
  check(document.querySelectorAll('[data-goal-status]').length === 0, 'New goals have no selected status');
  check(!document.body.textContent.includes('Before text') && !document.body.textContent.includes('After text'), 'No status-position controls');
  await click('Continue');
  check(heading('Review goals and BAU') && document.body.textContent.includes('Choose Done, WIP'), 'Unreviewed goals block continuation');
  document.querySelector('[aria-label="Goal 1: Done"]').click();
  await new Promise(r => setTimeout(r, 50));
  document.querySelector('[aria-label="Goal 2: WIP"]').click();
  await new Promise(r => setTimeout(r, 50));
  await reorderDown('Ship sign-in');
  check(document.querySelector('[data-step="4"] input').value === 'Finish exports' && document.querySelector('[data-step="4"] li [data-goal-status="wip"]'), 'Dragging goals preserves their outcomes');
  check(visible(document.querySelector('[data-step="4"] [data-bau-input]')), 'BAU shares the goals review step');
  document.querySelector('[data-bau-checkbox]').click();
  await new Promise(r => setTimeout(r, 40));
  await reorderDown('Support', true);
  check(document.querySelector('[data-step="4"] input[data-bau-input]').value === 'Reporting' && document.querySelectorAll('[data-step="4"] [data-bau-checkbox]')[1].checked, 'Keyboard reordering BAU preserves its ticks');
  const velocityReads = window.retroFixture.velocityReads;
  await click('Continue');
  await wait(() => document.getElementById('committed'));
  check(window.retroFixture.velocityReads > velocityReads, 'Entering numbers and notes automatically refreshes points');
  check(heading('Numbers and notes'), 'Numbers and notes follow BAU');
  const summary = document.querySelector('[data-testid="review-summary"]').textContent;
  check(summary.includes('DoneShip sign-in') && summary.includes('WIPFinish exports') && summary.includes('DoneSupport'), 'Notes show reviewed goals and BAU');
  check(document.getElementById('committed').value === '8' && document.getElementById('completed').value === '5', 'Report totals fill after closing the sprint');
  check(!button('View report'), 'Report is only its own step');
  fill('comments', 'Preserve this review');
  await click('Continue');
  const previewBox = document.querySelector('[data-testid="retro-preview"]');
  check(getComputedStyle(previewBox).maxHeight === 'none' && previewBox.scrollHeight <= previewBox.clientHeight, 'Message preview shows its full contents without internal scrolling');
  check(!document.querySelector('[aria-label="Manage mail recipients"]') && button('Mail team').title.includes('pete@skillion.tech'), 'Mail recipients are read-only and available on hover');
  const preview = previewBox.textContent;
  check(preview.includes('DONE Ship sign-in') && preview.includes('WIP Finish exports'), 'Email puts statuses before goal text');
  check(preview.includes('Preserve this review'), 'Email contains edited notes');
  check(!button('Reset form'), 'Sending does not offer to discard the review');
  check(button('Mail team')?.dataset.variant === 'default', 'Mail team is the blue primary action');
  check(button('Copy')?.dataset.variant === 'outline', 'Copy is secondary');
  localStorage.setItem('plan:marketing', 'Existing draft');
  await click('Continue');
  await wait(() => heading('Plan the next sprint'));
  check([...document.querySelectorAll('#plan-goals input')].map(input => input.value).join('\n') === 'Existing draft\nFinish exports', 'Unfinished goals carry over without replacing saved work or duplicating lines');
  check(document.getElementById('comments').value === 'Preserve this review', 'Jira refresh preserves review notes');
  check(document.querySelector('[data-goal-status="done"]') && document.querySelector('[data-goal-status="wip"]'), 'Jira refresh preserves explicit outcomes');
  check(!document.body.innerText.includes('Use unfinished goals'), 'No extra carryover action is needed');
  check([...document.querySelectorAll('[aria-label^="Reorder "]')].filter(visible).length === 5, 'Plan goals and BAU use drag handles');
  await wait(() => document.querySelector('[data-sonner-toast]'));
  check(document.querySelector('[data-sonner-toaster]').dataset.yPosition === 'top' && document.querySelector('[data-sonner-toaster]').dataset.xPosition === 'center', 'Carryover toast appears at the top center');
  check(document.querySelector('[data-sonner-toast]').textContent.includes('Filled unfinished goals'), 'Carryover is confirmed in a toast');
  await reorderDown('Existing draft');
  check(document.querySelector('#plan-goals input').value === 'Finish exports', 'Planned goals can be dragged');
  await reorderDown('Reporting');
  check(document.querySelector('#heading-plan').parentElement.querySelector('[data-bau-input]').value === 'Support', 'Planned BAU can be dragged');
  await click('Continue');
  check(document.body.innerText.includes('Target sprint: Pilot Sprint 3'), 'Targets latest future sprint in board order');
  window.retroFixture.future.at(-1).goal = 'Another person planned this';
  await click('Push to Jira');
  await wait(() => document.body.textContent.includes('Jira changed.'));
  check(heading('Push the plan to Jira'), 'Changed Jira goal requires review');
  await wait(() => visible(document.getElementById('merge-text')));
  check(document.querySelector('[data-testid="current-jira-goals"]').textContent.includes('Another person planned this'), 'Conflict shows refreshed Jira goals beside preserved draft');
  await click('Keep existing goals');
  check(document.getElementById('merge-text').value.includes('Another person planned this'), 'Existing goal is retained in merge preview');
  const editedMerge = 'Manually added notes\n\n' + document.getElementById('merge-text').value;
  fill('merge-text', editedMerge);
  await new Promise(r => setTimeout(r, 40));
  window.retroFixture.future.at(-1).goal += '\nConcurrent change';
  await click('Push to Jira');
  await wait(() => document.querySelector('[data-testid="current-jira-goals"]').textContent.includes('Concurrent change'));
  check(document.getElementById('merge-text').value === editedMerge, 'Merge edits survive a write conflict');
  await click('Cancel');
  await wait(() => ![...document.querySelectorAll('[role="dialog"]')].some(visible));
  await click('Push to Jira');
  check(document.getElementById('merge-text').value === editedMerge, 'Merge edits survive closing and reopening conflict review');
  fill('merge-text', 'Concurrent change\n' + editedMerge);
  await new Promise(r => setTimeout(r, 40));
  await click('Push to Jira');
  await wait(() => heading('All done'));
  check(window.retroFixture.writes.at(-1).expectedSprintId === 45, 'Push uses the existing latest sprint');
  check(window.retroFixture.writes.at(-1).goal.includes('Another person planned this'), 'Push preserves approved existing content');
  check(window.retroFixture.writes.at(-1).goal.includes('Finish exports\nExisting draft') && window.retroFixture.writes.at(-1).goal.includes('- [ ] Support\n- [ ] Reporting'), 'Push preserves dragged goal and BAU order');
  check(window.retroFixture.future.length === 2, 'No extra sprint is created');
  check(Boolean(document.querySelector('[data-testid="completion-confetti"]')), 'Successful push celebrates with confetti');
  const pushCount = window.retroFixture.writes.length;
  await click('Back to sprints');
  for (let i = 0; i < 7; i++) await click('Continue');
  check(heading('All done') && window.retroFixture.writes.length === pushCount, 'Revisiting an appended plan does not push it twice');
  check(!document.querySelector('[data-testid="completion-confetti"]'), 'Restoring a completed plan does not repeat confetti');
  await click('Back');
  await click('Add goal');
  const added = [...document.querySelectorAll('#plan-goals input')].at(-1);
  added.id = 'added-plan-goal';
  fill('added-plan-goal', 'B');
  await click('Continue');
  await click('Push to Jira');
  const updated = document.getElementById('merge-text').value;
  check(updated.includes('Manually added notes') && updated.includes('Concurrent change') && updated.includes('Existing draft\nB'), 'Updating a pushed plan preserves prior merged notes and new goals');
  check(updated.split('Finish exports').length === 2 && updated.split('\nBAU\n').length === 2, 'Updating a pushed plan does not duplicate goals or BAU');
  await click('Cancel');
  await wait(() => ![...document.querySelectorAll('[role="dialog"]')].some(visible));
  await click('Back');
  const carryoverInput = document.querySelector('#plan-goals input');
  carryoverInput.id = 'edited-carryover';
  fill('edited-carryover', 'Renamed exports');
  await click('Back');
  await click('Continue');
  let goalValues = [...document.querySelectorAll('#plan-goals input')].map(input => input.value);
  check(goalValues.includes('Renamed exports') && !goalValues.includes('Finish exports'), 'Re-entering planning preserves renamed carryover');
  document.querySelector('#plan-goals [aria-label="Remove goal 1"]').click();
  await click('Back');
  await click('Continue');
  goalValues = [...document.querySelectorAll('#plan-goals input')].map(input => input.value);
  check(!goalValues.includes('Renamed exports') && !goalValues.includes('Finish exports'), 'Re-entering planning preserves deleted carryover');
  check(document.documentElement.scrollWidth <= innerWidth, 'Workflow fits the viewport');
  return results;
}

if (process.argv.includes('--fixture-script')) {
  console.log(`(${installFixture.toString()})();`);
} else if (process.argv.includes('--browser-script')) {
  console.log(`(${runChecks.toString()})()`);
} else {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(installFixture);
    const index = process.argv.indexOf('--url');
    await page.goto(index < 0 ? 'http://localhost:4321' : process.argv[index + 1]);
    console.log(await page.evaluate(runChecks));
  } finally { await browser.close(); }
}
