import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
const required = [
  'data-workflow-mode="retro"',
  'data-shell-copy="retro"',
  'data-shell-copy="plan"',
  'data-form-fallback',
  'Loading sprint workspace…',
  '>Space<',
];
const missing = required.filter((text) => !html.includes(text));

// React is client-only, so tab semantics or labels in the prerendered HTML can
// only be inert imitations. The fallback should describe the wait honestly.
const forbidden = ['role="tablist"', 'role="tab"', '>Retro</span>', '>Plan</span>'];
const fakeTabs = forbidden.filter((text) => html.includes(text));

if (missing.length > 0 || fakeTabs.length > 0) {
  console.error(`Initial HTML is missing: ${missing.join(', ')}`);
  if (fakeTabs.length > 0) {
    console.error(`Initial HTML fallback contains inert tabs: ${fakeTabs.join(', ')}`);
  }
  process.exitCode = 1;
} else {
  console.log('Initial HTML contains both workflow shells and an honest loading fallback.');
}
