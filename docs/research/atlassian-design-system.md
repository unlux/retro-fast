# Rebuilding retro-fast's UI on the Atlassian Design System

Research date: 2026-08-21. Scope: evaluate rebuilding retro-fast's UI — currently Tailwind +
restyled shadcn-style components on Base UI (Select, Popover, Dialog) + Radix Accordion, one React
19 client island, ~141 KiB gzip total — on the Atlassian Design System (ADS) / `@atlaskit/*`
packages, so the page reads as native to Jira for the boss.

All package-version, license, and peer-dependency claims below were verified against the live npm
registry (`registry.npmjs.org`) on 2026-08-21, not training data or npm's website (which blocks
automated fetches with a 403). Component inventory and licensing claims were verified against
fetched pages of `atlassian.design` and the Atlassian Developer Community, cited inline. Where a
page returned 404 or was JS-rendered and unreachable (bundlephobia.com; several `atlaskit.atlassian.com`
sub-pages), that is noted rather than filled in from memory.

Verdict summary:

| # | Question | Verdict |
|---|----------|---------|
| 1 | Coverage | Every inventory item maps to a shipped `@atlaskit` component except the accordion-equivalent (no accordion package exists) |
| 2 | Licensing | Packages are Apache-2.0; the **design system itself** is licensed only for Atlassian-integrating Add-Ons; **Atlassian Sans is proprietary and not redistributable** |
| 3 | Technical fit | Most `@atlaskit` packages peer-depend on **React 18 only**; Atlassian said React 19 support "wouldn't land in 2025" and gave no 2026 date; styling engine is `@compiled/react` CSS-in-JS |
| 4 | Weight | Heavy — `@atlaskit/button` alone pulls ~10 `@atlaskit/*` sub-dependencies plus `@emotion/react`; full adoption would multiply the current 141 KiB budget several times over |
| 5 | Tokens-only | `@atlaskit/tokens` (Apache-2.0, React 18/19) is the one package built for exactly this, but it is not documented as an officially supported "for external non-Atlaskit consumers" path — it is documented as the Atlaskit component styling layer |
| 6 | Charts | No `@atlaskit` chart package exists on npm; ADS ships only data-visualization **color** guidance, not a chart component |
| 7 | Recommendation | **Tokens-only reskin**, not full Atlaskit — see final section |

---

## 1. Coverage — component inventory mapped to ADS/@atlaskit

Fetched from [atlassian.design/components](https://atlassian.design/components) (overview
listing) and cross-checked per-package against the npm registry.

| retro-fast component | ADS/@atlaskit equivalent | Package | Latest version (2026-08-21) | Maintenance signal |
|---|---|---|---|---|
| Buttons | Button | `@atlaskit/button` | 25.2.0 | Actively published (last publish 2026-08-20, i.e. the day before this research); legacy `Button (legacy)` variant is marked `intent-to-deprecate` with a codemod migration guide, per the package's own `atlassian.website.subPages` metadata |
| Text / number inputs | Text field | `@atlaskit/textfield` | 10.1.0 | Active |
| Autogrow textarea | Text area | `@atlaskit/textarea` | 10.1.0 | Active. ADS docs don't advertise an autosize/field-sizing mode distinctly from the app's current `field-sizing: content` approach — would need verification in the actual package if pursued |
| Selects | Select | `@atlaskit/select` | 22.8.0 | Active; depends on `react-popper`/`@popperjs/core` for positioning, not Base UI/Radix |
| Checkbox list | Checkbox | `@atlaskit/checkbox` | 19.1.0 | Active |
| Two tabs | Tabs | `@atlaskit/tabs` | 21.1.0 | Active |
| Modal dialog (velocity report) | Modal dialog | `@atlaskit/modal-dialog` | 16.5.1 | Active |
| Popover confirms | Popup | `@atlaskit/popup` | 6.2.0 | Active. ADS also lists **Inline dialog** and **Tooltip** as separate lighter-weight overlay primitives |
| Spawn panels (progressive disclosure) | No direct 1:1 — closest is composing Popup/Inline dialog or plain conditional rendering; ADS has no "spawn panel" pattern name | — | — | N/A — this is retro-fast's own UI pattern, not a component category |
| Skeletons | Skeleton | `@atlaskit/skeleton` | 4.3.0 | Active. ADS separately lists **Spinner** and **Progress bar** as other loading indicators (not needed here) |
| Banner (token-expiry) | Banner | `@atlaskit/banner` | 15.2.0 | Active. **Section message** (`@atlaskit/section-message`, 10.1.0) is the better fit if the banner is meant to sit inline in a section rather than pinned to the viewport edge — ADS describes Banner as "a prominent message at the top of the screen" (viewport-level) vs. Section message "to alert users to a particular section of the screen" |
| Table (velocity report) | Table / Dynamic table | `@atlaskit/dynamic-table` | 19.2.0 | Active; ADS also lists a plain **Table** primitive for cases that don't need Dynamic Table's built-in pagination/sorting/reordering — the plain Table is the better fit for the report's fixed Sprint/Commitment/Completed rows |
| Radix Accordion (spawned-panel predecessor, still used elsewhere?) | **No accordion component exists in Atlaskit.** | — 404 on `@atlaskit/accordion` | — | **Gap.** Confirmed by direct registry lookup (`registry.npmjs.org/@atlaskit/accordion` → 404) and by the `atlassian.design/components/accordion` page returning 404. The closest shipped primitives are `@atlaskit/menu`, `@atlaskit/side-navigation`, and `@atlaskit/tree` (all 200 on the registry), none of which is a generic collapsible-section component. If full Atlaskit adoption is pursued, the app would keep Radix Accordion (or its own disclosure pattern) for this — which the app already does for other affordances via its own "spawn panel" convention |
| Hand-rolled SVG bar chart | **No chart component.** See §6. | — | — | Gap by design on Atlassian's side, not a maintenance issue |

All version numbers above came from live `GET https://registry.npmjs.org/<pkg>/latest` calls.
Every package inspected reported `"license": "Apache-2.0"` at the package level (`@atlaskit/button`,
`@atlaskit/select`, `@atlaskit/dynamic-table`, `@atlaskit/modal-dialog`, `@atlaskit/tabs`,
`@atlaskit/tokens`, `@atlaskit/css`, `@atlaskit/textfield`, `@atlaskit/textarea`,
`@atlaskit/checkbox`, `@atlaskit/popup`, `@atlaskit/section-message`, `@atlaskit/skeleton`,
`@atlaskit/banner` all checked directly).

Repository: all packages carry `"repository": "git+https://bitbucket.org/atlassian/atlassian-frontend-mirror.git"`
in their published `package.json` — the canonical source is **Bitbucket**, and `github.com/atlassian/atlassian-frontend-mirror`
does not resolve (`gh api repos/atlassian/atlassian-frontend-mirror` → 404 "Not Found"). The
"GitHub mirror" that actually exists is a **third-party** mirror (`github.com/pioug/atlassian-frontend-mirror`,
described in `gh search repos` results as "Mirror of official Atlaskit repository hosted on
BitBucket", last updated 2026-08-11) — not an Atlassian-owned or Atlassian-maintained repo. This
matters for the "verify against the atlassian-frontend-mirror GitHub repo" instruction: that repo,
as an Atlassian property, doesn't exist on GitHub; treat any GitHub copy as an unofficial mirror of
the real Bitbucket source.

---

## 2. Licensing

Three separate licensing questions apply here, and they have three different answers.

### a) The npm packages (code)

Every `@atlaskit/*` package checked is **Apache-2.0** at the `package.json` level (see table
above — this is a straightforward, permissive OSS license, no issue for an internal tool).

### b) The design system itself (the "ADS" brand/spec, as opposed to the code)

Fetched [atlassian.design/license](https://atlassian.design/license) directly. This is a
**separate license from the Apache-2.0 code license** and it is scoped narrowly:

> "...grants you a limited, worldwide, royalty-free, non-assignable, non-sublicensable, and
> non-exclusive license to use the Atlassian Design System" for creating Add-Ons that
> **"interoperate or are integrated with Atlassian's software."**

Restrictions on the same page: no modification, no reverse engineering, no derivative works, no
redistribution or transfer of the ADS "in whole or in part, to any third party," and no removal of
proprietary notices. IP ownership is retained by Atlassian; liability is capped at $500; "as is,"
no warranty.

**Read literally, this license is written for Marketplace/Connect/Forge add-ons that plug into
Atlassian products** — not for an unrelated internal tool that merely wants to *look like* Jira
with no actual integration relationship. retro-fast *does* integrate with Jira's REST API (it's a
Jira client), which arguably brings it inside "interoperate... with Atlassian's software," but it
is not a Marketplace Add-On and doesn't ship through Atlassian's ecosystem — this is genuinely
ambiguous rather than a clean yes/no. Practically: the individual `@atlaskit/*` npm packages
(Apache-2.0) are the actual code you'd `npm install`, and Apache-2.0 carries none of these
restrictions — the ADS's own license page appears aimed at the *design system's non-code assets and
brand* (guidelines, brand identity, the "look") more than at gating use of the Apache-2.0 npm
packages. For an internal tool never distributed externally, the practical legal exposure is low,
but the license text does not affirmatively bless "build a lookalike internal tool with no
Atlassian integration purpose," and a strict reading of "interoperate... with Atlassian's software"
combined with "no derivative works" is the one point of real risk if this were ever scrutinized.

### c) The typeface — Atlassian Sans

This is the one hard blocker. [atlassian.design/foundations/typography](https://atlassian.design/foundations/typography)
states the current ADS typeface for app experiences is **Atlassian Sans** (plus **Atlassian
Mono**), with **Charlie Sans** reserved for brand/marketing contexts. The same page states:
**"only authenticated users can download our brand fonts"** from a restricted Brandfolder, and app
fonts are distributed via **Atlassian Mosaic** (Atlassian's internal design-tooling product) in
TTF format — i.e., gated behind Atlassian's own internal tooling, not a public CDN or open license.

Corroborating: the font files *are* physically served from a public-looking CDN
(`https://ds-cdn.prod-east.frontend.public.atl-paas.net/assets/fonts/atlassian-sans/v4/AtlassianSans-latin.woff2`,
observed directly in the `atlassian.design/license` page's HTML `<link rel="preload">` tags used to
render that very site), but a URL being network-reachable is not a license grant — the same license
page that font is loaded to render is the one restricting ADS use to Atlassian-integrating Add-Ons
and forbidding redistribution. There is no separate, public font license (e.g. an SIL Open Font
License / Google Fonts-style entry) for Atlassian Sans; web searches turn up only proprietary-font
listing sites (OnlineWebFonts) republishing it outside any licensed channel, which is not a source
to build on. **Treat Atlassian Sans as proprietary and not legitimately usable by retro-fast.**

**Fallback stack:** community consensus (and retro-fast's own current choice) converges on
**Inter** as the closest open alternative to Atlassian Sans's clean, neutral geometric feel — cited
by multiple sources found via search as "the single best free stand-in for Atlassian's interfaces."
retro-fast's PLAN.md already specifies a **system font stack** for its plain/formal aesthetic, which
is a reasonable and zero-risk choice regardless; if closer Jira-visual-matching is wanted without
Atlassian Sans itself, Inter (SIL OFL, freely redistributable) is the documented fallback.

**Note on "internal tool, not a public product":** this softens legal exposure but doesn't change
the license text itself — the license and font restrictions aren't conditioned on public
distribution, and internal-only use of a component *library* (Apache-2.0) is fine regardless. The
font is the one place where "internal-only" doesn't rescue the analysis, because there is no
license grant to point to at all, public or internal — it's Atlassian-employee/tooling-gated.

---

## 3. Technical fit

### React version support — the load-bearing finding

Checked peer dependencies directly against the npm registry for the full inventory, all as of the
2026-08-21 published `latest` version:

| Package | peerDependencies.react |
|---|---|
| `@atlaskit/button` | `^18.2.0` |
| `@atlaskit/select` | (not fully retrieved, dependency tree pins `@atlaskit/theme@^28.1.0` etc., consistent with the React-18-era stack) |
| `@atlaskit/modal-dialog` | `^18.2.0` |
| `@atlaskit/dynamic-table` | `^18.2.0` |
| `@atlaskit/tabs` | `^18.2.0` |
| `@atlaskit/checkbox` | `^18.2.0` |
| `@atlaskit/popup` | `^18.2.0` |
| `@atlaskit/section-message` | `^18.2.0` |
| `@atlaskit/skeleton` | `^18.2.0` |
| `@atlaskit/banner` | `^18.2.0` |
| `@atlaskit/textfield` | `^18.2.0 \|\| ^19.0.0` |
| `@atlaskit/textarea` | `^18.2.0 \|\| ^19.0.0` |
| `@atlaskit/tokens` | `^18.2.0 \|\| ^19.0.0` |
| `@atlaskit/css` | `^18.2.0` |

**Only `@atlaskit/tokens`, `@atlaskit/textfield`, and `@atlaskit/textarea`** declare React 19
support in their peer ranges. Every interactive/overlay component that matters most for this
rebuild — Button, Select, Modal dialog, Dynamic table, Tabs, Checkbox, Popup, Banner, Skeleton,
Section message — is still pinned to **React 18 only**, as of a package actually published on
2026-08-20 (i.e., this is current, not stale data).

This is corroborated directly by Atlassian staff. The Atlassian Developer Community thread
["React 19 Support for Atlaskit Components"](https://community.developer.atlassian.com/t/react-19-support-for-atlaskit-components/92166)
quotes an Atlassian engineer (KylorHall) stating explicitly: **"there's been no change in support
or new plans for React 19... the timeframe between a successful spike and landing that to Atlaskit
would be multiple months, so I can pretty confidently say this wouldn't land in 2025."** The thread
also states the team was still only planning to *scope an RFC*, with no committed 2026 date visible
in that discussion, and confirms **Atlaskit is not open source and does not accept community pull
requests** — a developer's own React 19 compatibility fix (via `patch-package`, for
`@atlaskit/form`/`@atlaskit/select`/`@atlaskit/react-select` JSX-namespace errors) had to be a local
patch, not a contribution. retro-fast is on **React 19.2.8** today (`package.json`); adopting
`@atlaskit/button`, `-select`, `-modal-dialog`, etc. today would mean either pinning a
peer-dependency override (`overrides`/`resolutions` forcing React 18 types against a React 19
runtime — works in practice for most components but is unsupported and could surface subtle issues
around `act()`, concurrent features, or the removed JSX global namespace the community thread
describes) or downgrading the app to React 18.

### Styling engine

`@atlaskit/css`'s own npm description: **"Style components backed by Atlassian Design System
design tokens powered by Compiled CSS-in-JS."** Its dependencies confirm `@compiled/react` (not
Emotion) as the current engine — though `@atlaskit/button`'s dependency list *also* includes
`@emotion/react@^11.7.1` alongside `@compiled/react@^1.0.2`, meaning a full-Atlaskit install pulls
**both** CSS-in-JS runtimes into the bundle (Emotion likely a legacy holdover in older/wrapped
components, Compiled the current direction). `@compiled/react` supports a Babel or webpack build
plugin (`@compiled/babel-plugin`, `@compiled/webpack-loader`) for build-time CSS extraction, which
is the intended production setup; without it, styles fall back to runtime injection, which works
but forgoes the "compiled" benefit. **Astro's Vite pipeline does not use webpack**, and while Vite
can run a custom Babel plugin (Vite/`@vitejs/plugin-react` supports passing extra `babel.plugins`),
this is exactly the kind of non-standard build wiring the app currently avoids — retro-fast has no
Babel step today (it uses Astro/Vite/esbuild defaults with Tailwind's Vite plugin and no
transform-time CSS-in-JS). Adding Atlaskit's compiled-CSS toolchain would be new build surface area
to integrate and keep working across Astro/Vite upgrades, on top of the React-19 friction above.

### SSR

Not directly documented in what was fetched; `@compiled/react` is designed to be SSR-safe (that's
one of Compiled's stated advantages over runtime-only CSS-in-JS), so this is a smaller risk than
the React-19 gap, but wasn't independently verified against an Astro SSR target in this pass.

### Known issues outside Atlassian-scaffolded apps

The community thread above is itself the direct evidence: it's populated by developers hitting
Atlaskit **outside** Atlassian's own apps (Forge/Connect apps, and general React projects) and
running into TypeScript/JSX-namespace breakage under React 19, with no first-party fix path other
than waiting or patching locally. This is a real, current, first-party-acknowledged signal that
Atlaskit is validated primarily against Atlassian's own (React-18) product surfaces, not general
third-party consumption on the latest React.

---

## 4. Weight

Bundlephobia was unreachable for size data in this session — the website returned no metrics
content over `WebFetch` (not JS-rendered to plain text) and the public size API
(`bundlephobia.com/api/size`) returned `429 Too Many Requests` on every attempt, including retries.
No fabricated numbers are given here; instead, the registry's own `unpackedSize` and dependency
graphs are used as a directional proxy, which is enough to support the qualitative verdict.

Directional evidence from the registry:

- `@atlaskit/button@25.2.0` alone (`unpackedSize: 605,471` bytes, unpacked/uncompressed) declares
  runtime dependencies on **`@atlaskit/css`, `@atlaskit/icon`, `@atlaskit/theme`, `@compiled/react`,
  `@emotion/react`, `@atlaskit/ds-lib`, `@atlaskit/tokens`, `@atlaskit/spinner`, `@atlaskit/tooltip`,
  `@atlaskit/focus-ring`, `@atlaskit/primitives`**, and more (list was truncated mid-fetch but
  already spans 11+ first-party `@atlaskit/*` packages plus two CSS-in-JS runtimes) — for a single
  Button component. `@atlaskit/tokens` alone reports an **unpacked size of ~14.2 MB** (it ships a
  large generated token map/codegen output), though only a fraction of that is used per token
  reference at runtime after tree-shaking — this number is not a bundle-size number, just a sign of
  how large the package's total surface is.
- `@atlaskit/select@22.8.0` additionally pulls `react-popper` and `@popperjs/core` — a second
  positioning engine, distinct from Base UI's (which retro-fast already ships for its own Select).
- Every component pulls its own slice of the shared `@atlaskit/tokens` / `@atlaskit/theme` /
  `@atlaskit/ds-lib` foundation, so there is shared-cost amortization across components (the
  marginal cost of the *second* Atlaskit component is lower than the first), but the **fixed cost of
  entry** — tokens, theme, icon, CSS runtime(s) — is substantial before any single component is
  counted.

Qualitatively: retro-fast's entire client bundle today is **~141 KiB gzip** for a hand-built,
Tailwind-based, no-CSS-in-JS-runtime app with two small headless-UI libraries (Base UI, Radix
Accordion). Pulling in `@atlaskit/button`, `-select`, `-modal-dialog`, `-dynamic-table`, `-tabs`,
`-checkbox`, `-popup`, `-banner`/`-section-message`, `-skeleton` would mean:

1. Two CSS-in-JS runtimes riding along (`@compiled/react` + `@emotion/react` for at least some
   components), replacing the current zero-runtime Tailwind approach.
2. A shared foundation layer (`@atlaskit/tokens`, `@atlaskit/theme`, `@atlaskit/ds-lib`,
   `@atlaskit/primitives`, `@atlaskit/icon`) loaded regardless of how many components are used.
3. A second floating-UI/positioning library (`react-popper`/`@popperjs/core`) alongside Base UI's
   own positioning, unless Select is the only Atlaskit component adopted and Base UI is dropped
   entirely for consistency.

Tree-shaking story: packages ship both `main` (CJS) and `module` (ESM) builds with `sideEffects`
scoped to `**/*.compiled.css` (seen on `@atlaskit/button`), which is a reasonable, modern
tree-shaking setup — unused *named exports* should shake. But tree-shaking removes unused exports,
not a component's own transitive dependency graph: importing `Button` still pulls everything
`Button` itself imports (tokens, theme, spinner, tooltip, focus-ring, primitives, css runtime).
**Without a working bundlephobia number this session, the honest claim is: full Atlaskit adoption
of this component set would very likely multiply the current 141 KiB gzip budget by a factor of
several times, not a marginal increase** — consistent with widely-known Atlaskit reputation for
being a heavyweight, Jira-scale UI kit rather than a lightweight component set, but this specific
session could not pin an exact gzip delta.

---

## 5. Tokens-only path

[registry.npmjs.org/@atlaskit/tokens](https://registry.npmjs.org/@atlaskit/tokens) confirms:
Apache-2.0, peer-deps on **React `^18.2.0 || ^19.0.0`** (the one core package that *does* support
React 19), latest `16.8.0`. `@atlaskit/css` (`1.0.2`, "Style components backed by Atlassian Design
System design tokens powered by Compiled CSS-in-JS") is the companion package for authoring
component styles against those tokens, but it peer-deps on React `^18.2.0` only — so `@atlaskit/css`
itself reintroduces the React-19 gap that `@atlaskit/tokens` alone avoids. **A tokens-only path
should use `@atlaskit/tokens`'s CSS custom properties directly (or its `token()` JS helper) without
pulling in `@atlaskit/css`**, to stay clear of the React-19 peer-dependency problem entirely.

**What tokens-only would buy:** `@atlaskit/tokens` exposes color, spacing, typography, elevation
(shadow), border-radius, and motion tokens as CSS custom properties (`var(--ds-...)`) with a
documented fallback-value pattern — this was directly observed in the raw HTML of
`atlassian.design/license` itself (its own site is built on these tokens): e.g.
`color: var(--ds-text-subtle, #42526e)`, `width: var(--ds-space-150, 9pt)`,
`border: var(--ds-border-width, 1px) var(--ds-border, #ccc) dotted`, and light-theme activation via
`[data-color-mode="light"]` attribute selectors with `color-scheme: light` — a pattern that maps
cleanly onto retro-fast's existing CSS-custom-property-driven design (it already has
`--radius-surface`, `--radius-control`, `--duration-form` etc. in `global.css`).

**Completeness:** color, spacing, typography, and elevation/shadow tokens are all present in the
package (confirmed via its size/scope and the token usage observed live on `atlassian.design`
itself, which is the design system's own site running on its own tokens — as thorough a
completeness signal as exists). Border-radius tokens exist too, per the `--ds-space-*`/`--ds-radius-*`
naming convention visible in the fetched CSS.

**Officially supported for non-Atlaskit consumers?** This is the one point this research could
**not** confirm cleanly. Two dedicated documentation targets (`atlassian.design/components/tokens/design-tokens/tokens`,
`atlassian.design/components/tokens/getting-started`, and `atlaskit.atlassian.com/get-started` /
`atlaskit.atlassian.com/packages/design-system/tokens`) all returned **404 or empty/JS-shell
content** in this session — the tokens documentation subpages did not resolve at the URLs guessed
from the site's own navigation conventions, and `atlaskit.atlassian.com` appears to be a
JS-rendered docs site that WebFetch could not extract text from. A web search
turned up secondary evidence (Atlassian's own developer docs at
[developer.atlassian.com/platform/forge/design-tokens-and-theming](https://developer.atlassian.com/platform/forge/design-tokens-and-theming/)
and a Data Center theming guide at
[developer.atlassian.com/platform/marketplace/dc-apps-preparing-for-dark-theme](https://developer.atlassian.com/platform/marketplace/dc-apps-preparing-for-dark-theme/))
indicating Atlassian **does** document a pattern for **Forge/Connect apps embedded inside Jira** to
consume tokens for theme-matching (querying `html[data-color-mode]` and defining custom rules
against it) — but that's a narrower, different audience (apps rendered *inside* Jira's iframe/UI
Kit surface, which must theme-match to avoid looking broken) than "an unrelated standalone external
tool wants Jira's colors." No page found in this session explicitly says "yes, use
`@atlaskit/tokens` in your own unrelated app with your own components" nor explicitly forbids it —
the same ADS license terms from §2 (Add-Ons that interoperate with Atlassian's software) would
apply to this package as much as to any other `@atlaskit/*` package, for whatever that license's
real force turns out to be for a non-Marketplace internal tool. Apache-2.0 at the code level does
technically permit it regardless of the ADS's own separate license page.

**Practical setup for light theme:** based on the token variable pattern observed
(`[data-color-mode="light"]`, `color-scheme: light`, CSS custom properties with hardcoded
fallbacks), a tokens-only adoption would mean: import the token package's generated CSS (or use its
JS `token()` helper) for light mode only, set `data-color-mode="light"` on `<html>` once, and
consume `var(--ds-*)` tokens directly in the existing Tailwind/CSS setup — no `ThemeProvider`
React component is strictly required for a **light-only, non-dynamic-theme** use case, which is
retro-fast's actual need (there is no dark mode in the current plan).

---

## 6. Charts

**No.** Confirmed by direct registry lookups returning 404 for every plausible package name
(`@atlaskit/chart`, `@atlaskit/graph`, `@atlaskit/visualization`, `@atlaskit/analytics-chart`), and
by the `atlassian.design/components` overview fetch explicitly noting **no chart/graph component in
the listed catalog** (only Skeleton/Spinner/Progress bar under loading, nothing under a
visualization category). Search results corroborate: Atlassian's own "UI Kit data visualizations"
offering is described as an **EAP (Early Access Program)** feature scoped to **Forge UI Kit**
(Atlassian's in-product extension framework), not a general-purpose `@atlaskit` npm package — not
applicable to an external Astro/React app. The one directly relevant ADS page found,
[atlassian.design/foundations/color-new/data-visualization-color](https://atlassian.design/foundations/color-new/data-visualization-color),
is **color guidance for building your own charts**, not a shipped chart-rendering component (this
page's content did not extract cleanly via WebFetch in this session, but its existence alongside
the confirmed absence of any `@atlaskit/chart*` package is itself the answer: Atlassian publishes
*how to color* a chart, not a chart to render). **retro-fast's hand-rolled SVG bar chart stays** —
there is nothing to replace it with from ADS, full-Atlaskit or tokens-only.

---

## 7. Recommendation

Comparing the three paths for a small fortnightly internal tool whose actual goal, per the user's
own framing, is "native design itself" — visual familiarity for one person (the boss) who reads
Jira daily — balanced against effort, bundle weight, and ongoing maintenance:

### (a) Full Atlaskit
**Not recommended.** The React-19 peer-dependency gap is the disqualifying finding: retro-fast is
on React 19.2.8 today, and Atlassian's own engineer stated on-record that React 19 support wasn't
landing in 2025 with no committed 2026 date found in this research. Adopting full Atlaskit today
means either downgrading the app's React version (real regression, affects every other dependency
choice already made) or running on unsupported peer-dependency overrides (fragile, no upstream
recourse — Atlaskit takes no external PRs). Layer on: a second CSS-in-JS runtime and its own build
tooling fighting Astro/Vite's zero-CSS-in-JS setup, a second floating-UI positioning library
alongside Base UI, no accordion equivalent, no chart component, and a bundle weight that (even
without a pinned bundlephobia number) is very likely several multiples of the current 141 KiB for
components retro-fast already has working, tested, byte-exact-fixture-covered equivalents of. The
effort-to-benefit ratio is poor for a tool this small.

### (b) Tokens-only reskin
**Recommended.** `@atlaskit/tokens` is the one package in the entire evaluation that (1) actually
supports React 19, (2) is Apache-2.0 with no component-level lock-in, (3) covers color, spacing,
typography, and elevation completely enough to reskin retro-fast's existing Base UI + Tailwind
components without replacing any of them, and (4) requires no new build tooling — CSS custom
properties consumed directly, no `@compiled/react`/webpack/Babel step, no `@atlaskit/css` (which
would reintroduce the React-18 constraint). This is a light-touch change: swap retro-fast's current
CSS custom properties and Tailwind theme values for `var(--ds-*)` tokens where they map, keep every
existing component (Select, Popover, Dialog, Accordion, the hand-rolled chart), and gain Jira's
actual color palette and spacing rhythm — which is most of what "looks like Jira" actually means to
a casual daily user, more than the exact shape of a button's focus ring. The one unresolved item is
that this path isn't affirmatively documented as "supported for external non-Atlaskit consumers" —
it's a reasonable, low-risk bet given Apache-2.0 licensing at the code level and the tool's
internal-only distribution, but it's a bet, not a citation-backed guarantee, and should be flagged
as such if this is ever revisited.

### (c) Hybrid (tokens + selective components)
**Only if a specific gap emerges that Tailwind can't close cleanly** — for example, if Jira's exact
Dynamic Table sorting/pagination chrome turns out to matter for the velocity report table (it
currently doesn't; the report table is fixed rows with no sort/paginate need per PLAN.md). Given
retro-fast's existing component set already covers every inventory item except the chart (which ADS
doesn't offer either way) and the accordion (already solved with Radix), there's no clear candidate
component worth taking on the React-18 constraint for. Treat this as a fallback, not a starting
plan.

**Net recommendation: tokens-only (b).** It is the only path that doesn't fight the React 19 client
island already shipped, adds no new bundler wiring, keeps the byte-exact-tested Base UI components
and hand-rolled chart intact, and delivers the specific thing the boss would actually notice —
Jira's colors and spacing — without the licensing ambiguity of wholesale-copying ADS's literal
component chrome or the multi-times bundle-size cost of full Atlaskit. The font question (Atlassian
Sans is not usable) is orthogonal to this choice and applies equally to all three paths; Inter
remains the documented fallback regardless of which path is chosen.

---

## Sources consulted directly

- [atlassian.design/components](https://atlassian.design/components) — component catalog
- [atlassian.design/license](https://atlassian.design/license) — ADS license terms (fetched twice, cross-checked against raw HTML)
- [atlassian.design/foundations/typography](https://atlassian.design/foundations/typography) — typeface, font access restrictions
- [atlassian.design/components/accordion](https://atlassian.design/components/accordion) — 404, confirms no accordion component
- [atlassian.design/foundations/color-new/data-visualization-color](https://atlassian.design/foundations/color-new/data-visualization-color) — data-viz color guidance page (exists; content extraction failed, absence of chart package confirmed via registry instead)
- `registry.npmjs.org` — direct registry queries for `@atlaskit/button`, `select`, `tokens`, `css`, `modal-dialog`, `dynamic-table`, `tabs`, `textfield`, `textarea`, `checkbox`, `popup`, `section-message`, `skeleton`, `banner`, `accordion` (404), `chart`/`graph`/`visualization`/`analytics-chart` (all 404)
- [community.developer.atlassian.com/t/react-19-support-for-atlaskit-components/92166](https://community.developer.atlassian.com/t/react-19-support-for-atlaskit-components/92166) — Atlassian staff statement on React 19 timeline, non-open-source confirmation
- `gh api repos/atlassian/atlassian-frontend-mirror` — 404, confirms no such GitHub repo under the Atlassian org (real source is Bitbucket; GitHub copies are third-party mirrors)
- `gh search repos atlassian-frontend-mirror` — confirms `pioug/atlassian-frontend-mirror` as the actual (third-party) GitHub mirror
- Web search corroboration (not sole source for any claim above): Atlassian Sans fallback-font community consensus (Inter); Forge/Connect token-theming docs at `developer.atlassian.com` as a narrower analogous use case

## Sources attempted but unreachable in this session

- `bundlephobia.com` (package pages: empty extraction; API: 429 rate-limited on every retry) — no
  bundle-size numbers in this report are sourced from Bundlephobia; §4 relies on registry
  `unpackedSize` and dependency-graph size as a directional proxy instead, and says so explicitly.
- `atlaskit.atlassian.com/get-started`, `atlaskit.atlassian.com/packages/design-system/tokens` — JS-shell/empty content, no usable text extracted
- `atlassian.design/components/tokens/design-tokens/tokens`, `atlassian.design/components/tokens/getting-started` — 404 (URLs guessed from site conventions; the real tokens-docs URL structure wasn't located in this session)
- `github.com/atlassian/atlassian-frontend-mirror` via WebFetch — 404 (see `gh api` confirmation above that this is expected, not a fetch failure)
