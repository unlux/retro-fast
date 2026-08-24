import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
const required = ['data-form-fallback', 'Loading sprint workspace', '>Space<', '>Retro<', '>Plan<'];
const missing = required.filter((text) => !html.includes(text));

if (missing.length > 0) {
  console.error(`Initial HTML is missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('Initial HTML contains the shared navigation and form fallback.');
}
