/** BAU list regression: each sprint shows its own Jira block, not every past sprint's.
 * Replays three Marketing sprints against in-browser fixtures. No Jira calls.
 * CLI: node scripts/bau-list-check.mjs --url http://localhost:4321
 */
import { chromium } from 'playwright';

const SPRINT_41 = ['Video Content Face to Camera ()', 'DMs to investors (50)', 'LIN text posts (2)',
  'Blogs (2)', 'Podcast production (1)', 'Email to Rex US investors (100)', 'BNI points 121, referrals et'];
const SPRINT_42 = ['Podcast production (1)', 'Video Content Face to Camera ()', 'DMs to investors (50)',
  'LIN text posts (2)', 'Blogs (2)', 'BNI meeting, 121, referrals et'];
/** What the old additive fill left in the Space's list by sprint 41. */
const UNION = ['Podcast', 'Video Content', 'DMs to investors', 'DMs', 'LIN text posts', 'Blogs', 'RFP #8',
  'Customer FUP', 'Video Content Face to Camera ()', 'DMs to investors (50)', 'LIN text posts ()', 'Blogs ()',
  'Podcast (1)', 'Email to Rex US investors (100)', 'BNI points 121, referrals et', 'LIN text posts (2)',
  'Blogs (2)', 'Podcast production (1)'];

function installFixture({ sprint41, sprint42, union }) {
  const block = items => `BAU\n${items.map(item => `- [ ] ${item}`).join('\n')}`;
  const sprint = (id, name, goal) => ({ id, name, state: 'closed', goal,
    startDate: '2026-11-05T00:00:00Z', endDate: '2026-11-12T00:00:00Z', completeDate: '2026-11-12T00:00:00Z' });
  // First load only: later reloads must keep what the app saved.
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    const unionItems = union.map((text, index) => ({ id: `u${index}`, text }));
    localStorage.setItem('retro:last-team', 'rex');
    localStorage.setItem('retro:last-sprint:rex', '41');
    localStorage.setItem('bau:rex', JSON.stringify(unionItems));
    localStorage.setItem('plan-bau:rex', JSON.stringify(unionItems));
    // A draft from before lists were per sprint: ticks, no `bauItems`.
    localStorage.setItem('retro:rex:41', JSON.stringify({
      title: 'Rex Retro #41', sprint: '41', titleTouched: false, statusPosition: 'before',
      goals: [{ id: 'g1', text: 'Voice Agent - Testing', status: 'done' }],
      committed: '8', completed: '5', comments: 'Kept', pluses: '', improvements: '',
      bauChecks: { u17: true, u0: true },
    }));
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
    if (url.pathname === '/api/spaces') return Response.json({ spaces: [] });
    if (url.pathname === '/api/velocity-report') return Response.json({ available: true, series: [] });
    if (url.pathname === '/api/velocity') return Response.json({ available: true, committed: 8, completed: 5 });
    if (url.pathname === '/api/sprints') {
      return Response.json({
        sprints: [sprint(42, 'SKIL Sprint 42', `Kick off handover work\n\n${block(sprint42)}`),
          sprint(41, 'SKIL Sprint 41', `Voice Agent - Testing\n\n${block(sprint41)}`)],
        future: [], defaultSprintId: 42, latestName: 'SKIL Sprint 42', boardUrl: null });
    }
    throw new Error(`Unexpected API call: ${url.pathname}`);
  };
}

const results = [];
const check = (condition, message) => { if (!condition) throw new Error(`FAILED: ${message}`); results.push(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.addInitScript(installFixture, { sprint41: SPRINT_41, sprint42: SPRINT_42, union: UNION });
  const index = process.argv.indexOf('--url');
  await page.goto(index < 0 ? 'http://localhost:4321' : process.argv[index + 1]);

  const bauTexts = () => page.$$eval('[data-step="4"] [data-bau-input]', nodes => nodes.map(node => node.value));
  const ticked = () => page.$$eval('[data-step="4"] li', rows => rows
    .filter(row => row.querySelector('[data-bau-checkbox]')?.checked)
    .map(row => row.querySelector('[data-bau-input]').value));
  const stored = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const pickSprint = async name => {
    await page.locator('#jira-sprint').getByRole('radio', { name: new RegExp(name) }).click();
  };

  await page.waitForSelector('#jira-sprint');
  await page.waitForFunction(() => document.querySelectorAll('[data-step="4"] [data-bau-input]').length > 0);
  check(same(await bauTexts(), SPRINT_41), 'An old draft opens with its sprint’s Jira block, not the union of past sprints');
  check(same(await ticked(), ['Podcast production (1)']), 'The old draft keeps its tick on a surviving item');
  const draft41 = await stored('retro:rex:41');
  check(draft41.goals[0].status === 'done' && draft41.comments === 'Kept', 'Repairing the list leaves the reviewed goals and notes alone');
  check(same(draft41.bauItems.map(item => item.text), SPRINT_41), 'The sprint’s list is saved in its draft');

  await pickSprint('SKIL Sprint 42');
  await page.waitForFunction(first => document.querySelector('[data-step="4"] [data-bau-input]')?.value === first, SPRINT_42[0]);
  check(same(await bauTexts(), SPRINT_42), 'A new sprint’s fill replaces the list with that sprint’s block');
  check(same(await ticked(), []), 'A new sprint starts with every box clear');
  check(same((await stored('bau:rex')).map(item => item.text), SPRINT_42), 'The Space’s latest list follows the fill');

  await pickSprint('SKIL Sprint 41');
  await page.waitForFunction(first => document.querySelector('[data-step="4"] [data-bau-input]')?.value === first, SPRINT_41[0]);
  check(same(await bauTexts(), SPRINT_41) && same(await ticked(), ['Podcast production (1)']), 'Reopening the earlier sprint shows its own list and ticks');
  check(same((await stored('bau:rex')).map(item => item.text), SPRINT_42), 'Reopening an earlier sprint does not overwrite the Space’s latest list');

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('[data-step="4"] [data-bau-input]').length > 0);
  check(same(await bauTexts(), SPRINT_41), 'The sprint’s list survives a reload');

  // Through to the plan step: its BAU copy starts as this sprint's list.
  for (let step = 1; step < 7; step += 1) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('#heading-plan');
  const planTexts = await page.$eval('#heading-plan', heading =>
    [...heading.parentElement.querySelectorAll('[data-bau-input]')].map(node => node.value));
  check(same(planTexts, SPRINT_41), 'The plan’s BAU starts as the reviewed sprint’s list, not an old saved copy');
  console.log(results.join('\n'));
} finally { await browser.close(); }
