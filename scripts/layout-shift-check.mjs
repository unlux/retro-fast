/**
 * Layout-shift harness for the dropdowns.
 *
 * The bug this exists to catch only happens on a machine with *classic*
 * (space-occupying) scrollbars: a scroll lock that removes the scrollbar frees
 * its width, and the page slides sideways for as long as the menu is open.
 * Headless Chromium — like macOS with "show scroll bars: when scrolling" —
 * defaults to *overlay* scrollbars, which occupy zero width, so the shift is
 * structurally impossible there and any measurement is a false negative.
 *
 * So the harness forces the failure mode into existence:
 *   - it launches the *full* Chromium binary under `--headless=new` rather than
 *     Playwright's default `chromium_headless_shell`. The shell always draws
 *     overlay scrollbars and ignores every flag and `::-webkit-scrollbar` rule
 *     that would normally opt a document out of them (measured: 0px either
 *     way); the full binary in new-headless mode draws real 15px classic ones,
 *     which is what the macOS Chrome this bug was reported from does.
 *   - the body is padded tall enough that the document genuinely overflows, so
 *     a scrollbar is actually present to be taken away.
 *
 * Then it measures `getBoundingClientRect().left` of a set of tracked elements,
 * plus the computed body padding, before / during / after opening each Select
 * and the confirm Popover, and reports the worst delta. A run whose measured
 * scrollbar width is 0 is rejected outright: that is the false negative the
 * original verification of this fix fell into.
 *
 * Usage: node scripts/layout-shift-check.mjs [--overlay] [--url <url>]
 *   --overlay   use the headless shell's overlay scrollbars — the environment
 *               the previous, false-negative verification actually measured.
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const overlayMode = args.includes('--overlay');
const urlIndex = args.indexOf('--url');
const url = urlIndex === -1 ? 'http://127.0.0.1:4321/' : args[urlIndex + 1];

/**
 * The page must actually overflow, or there is no scrollbar to remove and the
 * measurement is meaningless in either mode.
 */
const TALL = `body::after { content: ''; display: block; height: 3000px; }`;

/** Elements whose left edge must not move. Stable across both trees. */
const TRACKED = [
  'main',
  'h1',
  '#team',
  'footer',
  '[data-slot="button"]',
];

async function measure(page) {
  return page.evaluate((selectors) => {
    const rects = {};
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      rects[selector] = element ? element.getBoundingClientRect().left : null;
    }
    const body = getComputedStyle(document.body);
    const html = document.documentElement;
    return {
      rects,
      bodyPaddingLeft: body.paddingLeft,
      bodyPaddingRight: body.paddingRight,
      bodyMarginRight: body.marginRight,
      bodyInlineStyle: document.body.getAttribute('style') ?? '',
      /** > 0 proves a classic scrollbar is really present. */
      scrollbarWidth: window.innerWidth - html.clientWidth,
      documentOverflows: html.scrollHeight > html.clientHeight,
    };
  }, TRACKED);
}

function delta(before, during) {
  let worst = 0;
  const detail = {};
  for (const key of Object.keys(before.rects)) {
    const a = before.rects[key];
    const b = during.rects[key];
    if (a === null || b === null) continue;
    const d = Math.abs(b - a);
    detail[key] = Number(d.toFixed(2));
    if (d > worst) worst = d;
  }
  return { worst: Number(worst.toFixed(2)), detail };
}

async function openAndMeasure(page, label, open, close) {
  const before = await measure(page);
  await open();
  await page.waitForTimeout(250);
  const during = await measure(page);
  await close();
  await page.waitForTimeout(250);
  const after = await measure(page);

  const openDelta = delta(before, during);
  const closeDelta = delta(before, after);
  return {
    label,
    scrollbarWidth: before.scrollbarWidth,
    documentOverflows: before.documentOverflows,
    openDelta,
    closeDelta,
    padding: {
      before: [before.bodyPaddingLeft, before.bodyPaddingRight, before.bodyMarginRight],
      during: [during.bodyPaddingLeft, during.bodyPaddingRight, during.bodyMarginRight],
      after: [after.bodyPaddingLeft, after.bodyPaddingRight, after.bodyMarginRight],
    },
    inlineStyleWhileOpen: during.bodyInlineStyle,
  };
}

const browser = overlayMode
  ? await chromium.launch()
  : // `headless: false` + `--headless=new` selects the full Chromium binary in
    // new-headless mode. Plain `headless: true` picks the headless *shell*,
    // which only ever draws overlay scrollbars.
    await chromium.launch({ headless: false, args: ['--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Both selects need the sprint list, and the page will not render the sprint
// picker (only a skeleton) until /api/sprints answers.
await page.route('**/api/sprints*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      sprints: [
        { id: 1, name: 'Rex Sprint 31', state: 'closed', startDate: '2026-07-01', endDate: '2026-07-14' },
        { id: 2, name: 'Rex Sprint 32', state: 'active', startDate: '2026-07-15', endDate: '2026-07-28' },
      ],
      defaultSprintId: 2,
    }),
  }),
);
// Registered BEFORE the `**/api/velocity*` route below: Playwright matches
// routes most-recently-registered first, and that glob would otherwise swallow
// `/api/velocity-report` and answer it with the single-sprint shape.
await page.route('**/api/velocity-report*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      available: true,
      series: [
        { sprintId: 1, name: 'Rex Sprint 31', committed: 7, completed: 6 },
        { sprintId: 2, name: 'Rex Sprint 32', committed: 9, completed: 8 },
      ],
    }),
  }),
);
await page.route('**/api/velocity*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ available: true, committed: 7, completed: 6 }),
  }),
);

await page.addInitScript(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: TALL });
await page.waitForSelector('#team');
await page.waitForSelector('#jira-sprint');
await page.waitForTimeout(400);

const results = [];

results.push(
  await openAndMeasure(
    page,
    'Select (team)',
    async () => {
      await page.click('#team');
      await page.waitForTimeout(150);
    },
    async () => {
      await page.keyboard.press('Escape');
    },
  ),
);

results.push(
  await openAndMeasure(
    page,
    'Select (sprint)',
    async () => {
      await page.click('#jira-sprint');
      await page.waitForTimeout(150);
    },
    async () => {
      await page.keyboard.press('Escape');
    },
  ),
);

results.push(
  await openAndMeasure(
    page,
    'Popover (confirm)',
    async () => {
      await page.getByRole('button', { name: 'Reset form' }).click();
      await page.waitForTimeout(150);
    },
    async () => {
      await page.keyboard.press('Escape');
    },
  ),
);

/*
 * The report dialog — the third scroll-locking primitive, and the one where a
 * sideways slide would be loudest: a modal leaves the whole page visible behind
 * a translucent backdrop, so the entire document shifting under it is
 * impossible to miss.
 *
 * "View report" only exists for a *closed* sprint, so the picker is moved off
 * the mocked active sprint first.
 */
await page.click('#jira-sprint');
await page.waitForTimeout(200);
await page.getByRole('option', { name: /Sprint 31/ }).click();
await page.waitForTimeout(400);

results.push(
  await openAndMeasure(
    page,
    'Dialog (velocity report)',
    async () => {
      await page.getByRole('button', { name: 'View report' }).click();
      await page.waitForTimeout(300);
    },
    async () => {
      await page.keyboard.press('Escape');
    },
  ),
);

// ------------------------------------------------------------------ keyboard

await page.click('body', { position: { x: 5, y: 5 } });
await page.focus('#jira-sprint');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const keyboardOpen = await page.evaluate(() =>
  Boolean(
    document.querySelector('[data-slot="select-content"]') ??
      document.querySelector('[role="listbox"]'),
  ),
);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const keyboardSelected = await page.textContent('#jira-sprint');

await browser.close();

const mode = overlayMode
  ? 'OVERLAY scrollbars (headless shell — the old, false-negative environment)'
  : 'CLASSIC scrollbars (full Chromium, --headless=new)';
console.log(`\n=== Layout shift: ${mode} — ${url} ===`);
let failed = false;
for (const r of results) {
  const ok = r.openDelta.worst === 0 && r.closeDelta.worst === 0;
  if (!ok) failed = true;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${r.label}`);
  console.log(`  scrollbar width: ${r.scrollbarWidth}px   document overflows: ${r.documentOverflows}`);
  console.log(`  worst shift while open : ${r.openDelta.worst}px  ${JSON.stringify(r.openDelta.detail)}`);
  console.log(`  worst shift after close: ${r.closeDelta.worst}px`);
  console.log(`  body padding [L,R,marginR]  before ${JSON.stringify(r.padding.before)}`);
  console.log(`                              during ${JSON.stringify(r.padding.during)}`);
  console.log(`                              after  ${JSON.stringify(r.padding.after)}`);
  if (r.inlineStyleWhileOpen) console.log(`  body inline style while open: ${r.inlineStyleWhileOpen}`);
}

console.log(`\nkeyboard: Enter opened the sprint list = ${keyboardOpen}; after ArrowDown+Enter the trigger reads ${JSON.stringify(keyboardSelected)}`);

if (!overlayMode && results.some((r) => r.scrollbarWidth === 0)) {
  console.log(
    '\nHARNESS INVALID: scrollbar width measured 0 — this run saw overlay scrollbars, ' +
      'so it cannot observe the bug. This is exactly the false negative the first fix was verified against.',
  );
  process.exit(2);
}

console.log(failed ? '\nRESULT: SHIFT DETECTED' : '\nRESULT: no shift');
process.exit(failed ? 1 : 0);
