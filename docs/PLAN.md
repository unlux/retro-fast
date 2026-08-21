# retro-fast — build plan

A small internal tool that replaces the manual "copy sprint goals into Apple Notes, prefix
done/wip, note committed/completed, write comments/pluses/improvements, paste into Apple Mail"
retro ritual. One formal-looking page on Cloudflare Workers, behind Cloudflare Access.

Feasibility research: [docs/research/jira-api-feasibility.md](research/jira-api-feasibility.md).
All Jira claims below are grounded there.

## Stack

- **Astro** with `@astrojs/cloudflare` adapter, deployed as a Worker.
- The retro page itself is a mostly-static form with vanilla client-side JS (no framework needed);
  server-side code is limited to a few API routes that proxy Jira.
- **Cloudflare Access** in front of the deployed hostname (the app fronts a Jira credential, so it
  must not be publicly reachable).
- No database. Drafts live in `localStorage`; team config lives in a checked-in config file;
  secrets live in Worker secrets.

## The page

Deliberately plain and formal: system font stack, black on white, thin rules between sections,
and a two-step radius scale (see "Rounding" below).

The page is **the four numbered steps of the ritual**, in the order the boss performs it every
sprint: end the sprint → see the report → get filled in → check the goals and the numbers → add
the notes → copy or mail. The steps carry visible numerals in their headings, separated by
hairline rules, because a fortnightly sequence performed in a fixed order is a numbered list.

The default view shows **only what is touched every retro**. Everything occasional is a small
underlined text button that spawns its panel in place, and the collapsed state shows the field's
*value* rather than a lid — the point of folding something away is that you can still read it
without a box around it. (These replaced accordions, which cost a full-width row and a chevron on
every retro just to say "something is folded here".)

1. **Sprint** — team/space picker and sprint picker, then **one contextual primary action**:
   **End sprint** when the selected sprint is active (behind the confirm popover), **Fill from
   Jira** when it is closed. The sprint's state already decides what there is to do, so the
   button *is* the state; the old page showed a permanent prefill button plus an extra
   end-sprint row, one of which was always wrong. Beside it, a quiet **View report** —
   **closed sprints only**, because Jira computes the velocity snapshot at close and there is
   nothing to view before then. Below, an **Edit title** text button spawning the title and
   sprint-number fields, with the current title shown as quiet text beside it.
2. **Goals** — rows of goal text with the three-state `done` / `wip` / `not done` control, plus
   the status-position setting. **Paste goals** is a text button that spawns the paste area;
   it still opens itself automatically when Jira is unreachable, since it is then the only way
   in and a button somebody has to notice is not good enough.
3. **Numbers & notes** — `Commitment` / `Complete` inputs, then Comments / Pluses / Improvements.
   One step rather than two, because it is one sitting: you read the numbers off the report and
   write about them straight after.
4. **Send** — Copy and Mail team. The recipients list collapses to quiet text (`To a@x, b@y`)
   behind an **Edit recipients** affordance; it comes from the team config and is right on
   essentially every retro.

Spawned-panel state is React state and is **deliberately not persisted**. A draft is the retro
you typed; whether the recipients field was open last Tuesday is not part of it. Keeping it out
of the draft is also what lets a draft saved before this restructure restore into the new layout
untouched.

### The velocity report

A **Base UI Dialog** replicating Jira's own velocity report, opened by **View report** and
**automatically after a successful End sprint** — closing the sprint is what makes Jira compute
the snapshot, so that is the first moment the numbers exist, and reading them is the next thing
that happens anyway.

- **Paired-bar chart**, last ~12 sprints: grey `Commitment` bar and green `Completed` bar per
  sprint, sprint numbers along the x-axis, story points up the y-axis. Hand-rolled SVG — this
  is two rectangles per sprint and a pair of axes, and a chart library for that would outweigh
  the client bundle.
- **Table beneath** — Sprint / Commitment / Completed — matching the table Jira prints under its
  own report. It is the chart's *twin*, not its fallback: no value is reachable only by hovering.
- The **currently selected sprint** is highlighted in both: a pale ink wash behind its bars and
  on its table row, plus the only direct bar label on the chart and `aria-current` on the row.

**Why it is grey and green** when the rest of the page is ink on paper: those are Jira's own
colours for these two series, and the boss reads that report every sprint. Recolouring them into
this page's palette would make the one screen he already knows how to read unfamiliar.
Recognition beats palette consistency here, so the bars keep Jira's assignment and everything
around them — axes, ticks, labels, table — stays in the form's greys.

The craft rules that don't fight that resemblance are applied: a legend always present (two
series, so identity never rests on colour-matching alone); values on the axis, in the readout and
in the table rather than a number over every bar, with only the selected sprint directly
labelled; solid hairline gridlines, never dashed; a 2px surface gap inside each pair; bars capped
so a band keeps air instead of filling edge to edge; rounded data-ends that stay square at the
baseline, so a bar does not float off it. The hit target is the whole sprint band rather than the
bars themselves — hovering an 8-point bar exactly is a game — and keyboard focus shows the same
readout as the pointer. Reduced motion is honoured, and the dialog scrolls on a phone.

`niceScale` targets five bands rather than four: snapping the step *up* the 1/2/5/10 ladder
rounds the band count *down*, so aiming at a quarter of the max lands on three bands — Skillion
Labs' peak of 46 would ceiling at 60 and leave a third of the plot empty. The step never falls
below 1 (story points are whole) and the ceiling never below 5, so a board topping out at one
point still reads as flat rather than full-height.

### Rounding

Two radii, and only two. The page was square everywhere on the argument that a rounded corner is
the loudest "web app" tell — true of a *large* radius, the 12–16px pill-and-card look, but not of
a small one. A printed form is guillotined and stacked, and the paper softens its own corners.

- `--radius-surface` **8px** — things that *contain*: the report dialog, the expiry banner.
- `--radius-control` **6px** — things you *press or type in*: buttons, inputs, selects,
  textareas, popovers, skeletons, the goal status chip.

Containers take the larger step so a control inside one is visibly nested rather than concentric
with it. Select menu items take 4px, one step inside the popup's 6px, so a highlighted row does
not sit corner-to-corner with its container. There is no third value: four radii is what makes a
page read as unconsidered. Hairline rules stay straight lines — a rule is not a box. Print
flattens every radius to 0: on paper a field is a ruled line, and a line has no corners.

### Loading states

Every network wait is a **skeleton**, never a spinner: the sprint picker while the list loads, and
the goal rows and points inputs during a prefill. Each placeholder is sized to the control it
stands in for — the picker skeleton is `h-9` like the real trigger, the goal skeletons mirror
`GoalList`'s own row box — so the page does not move when the data lands. Verified in a headless
browser against a throttled server: section offsets, section heights and total document height are
byte-identical before and after the skeletons resolve. Labels stay visible throughout; only the
values are placeholders. The fade is dropped under `prefers-reduced-motion`.

### No layout shift from dropdowns

Opening a Select or the confirm Popover locks page scrolling. On a machine with **classic**
(space-occupying) scrollbars — the macOS "always show scroll bars" setting, and Windows generally —
a naive lock removes the scrollbar, frees its width, and slides the whole page sideways for as long
as the menu is open.

**The Select and Popover are built on [Base UI](https://base-ui.com), not Radix**, and that is the
fix. The two libraries lock scroll in opposite ways:

- **Radix** (`react-remove-scroll`) sets `overflow: hidden` on `<body>`, which *does* remove the
  scrollbar, then tries to pay the width back — it measures the scrollbar and injects a stylesheet
  full of `body[data-scroll-locked] { margin-right: 15px !important; padding: 0 … }` compensation.
  Paying back a width you just took away is a losing game: the number has to be measured, applied to
  the right box, and it lands on `body` padding, which is where the page's own `px-6` lives. Any
  page rule touching body padding is now in a cascade fight with an injected `!important` rule.
- **Base UI** never takes the width away. It locks `<html>` — the box that actually owns the
  viewport scrollbar — and sets **`scrollbar-gutter: stable` inline on `<html>` for the duration of
  the lock**. The gutter stays reserved, so nothing is freed, nothing needs measuring, and nothing
  is added back. While a menu is open the only inline style on `body` is `overflow: hidden`.

`global.css` keeps one `scrollbar-gutter: stable` on `html`, but it is no longer load-bearing for
the dropdowns — Base UI sets its own. It stays for the ordinary case: a page that grows past one
viewport mid-edit would otherwise gain a scrollbar and jump. The old `body[data-scroll-locked]`
workaround is gone; it was Radix-specific and now matches nothing.

Only the scroll-locking primitives moved. **Accordion, Label and Slot are still Radix** — they never
lock scroll, so there was nothing to fix and no reason to churn them.

#### Why the previous fix was "verified" and still broke

The old fix (`scrollbar-gutter: stable` plus a `body[data-scroll-locked]` rule restating the page's
padding) was checked in a headless browser that measured 0px. That verification was worthless:
**headless Chromium draws overlay scrollbars**, which occupy zero width. With a zero-width scrollbar
there is no width to free, so no shift is possible and every measurement reads 0 — a false negative
that cannot fail. The bug was only ever visible where the scrollbar has width, which is exactly the
machine the report came from and not the one the test ran on.

`scripts/layout-shift-check.mjs` is the honest harness. Two things make it honest:

1. It launches the **full Chromium binary under `--headless=new`**, not Playwright's default
   `chromium_headless_shell`. The shell always draws overlay scrollbars and ignores every flag and
   `::-webkit-scrollbar` rule that would normally opt out (measured: 0px either way); the full binary
   draws real 15px classic scrollbars. It then **rejects any run that measures a 0px scrollbar**, so
   the original false negative cannot recur silently.
2. It pads the document past one viewport, so a scrollbar genuinely exists to be removed.

Measured under that harness, on the page's tracked elements (`main`, `h1`, `#team`, `footer`, the
first button), before / during / after opening each Select and the Popover:

| | shift |
|---|---|
| Base UI, as shipped | **0px** |
| Base UI, with `global.css`'s gutter line removed | **0px** — it sets its own inline |
| Radix, as shipped | 0px — the CSS workaround did hold, but only just |
| Radix, with `global.css`'s gutter line removed | **7.5px** |

The last two rows are the point. The old fix was not wrong, it was *brittle*: it rested entirely on
one stylesheet declaration staying in force, with an injected `!important` rule fighting it and a
`padding` shorthand that silently zeroed `padding-left` if you pinned only the right. Base UI holds
at 0px even with that declaration gone, because the guarantee is inside the lock instead of spread
across two stylesheets that have to agree.

Overlay-scrollbar mode (`--overlay`) is still run, to confirm nothing regressed for the machines
where the bug never appeared in the first place.

### Goal rows have stable ids

Each goal carries an `id`, minted by `newGoal()` when the row is created — by a prefill, the
paste splitter, **Add goal**, or Enter-to-insert — and used as its React key.

This is not bookkeeping; it is what makes the list animate correctly. Keyed by array **index**,
deleting row 2 of 8 made React reuse each `<li>` for whichever goal slid up into that slot, so the
only node that actually unmounted was the *last* one — and that was the only node auto-animate
ever saw leaving. The list closed the gap instantly and then animated the wrong row away.
Confirmed in a headless browser by patching `Element.animate`: the leave keyframes fired on row 8.
Keyed by id, they fire on the deleted row while the rows below slide up from `+45px`.

`Goal.id` is **optional and ignored by every formatter** — the output is a pure function of text
and status — so the byte-exact fixture tests are unaffected. `withGoalIds()` migrates restored
drafts: goals saved before ids existed get one, statuses are normalized as they always were,
duplicate ids are replaced, and a malformed blob drops only the entries it cannot read rather
than discarding a typed retro. `crypto.randomUUID` is absent on insecure origins, so there is a
counter-plus-random fallback.

### Printing

The aesthetic is a printed form, so the page prints as a **document rather than a photograph of a
form**. `@media print` in `global.css`: fields render as their values on ruled underlines instead
of boxes (a page of empty rectangles reads as a blank form to fill in, which a finished retro is
not); textareas expand to show every line, with `field-sizing` turned back off so the height
resolves against the paper's width rather than the screen's; sections avoid breaking across
sheets. Anything marked `data-print-hide` — the Jira pickers and their instructions, the prefill
and end-sprint controls, the send actions — drops out, because a hint reading "click here to
refill from Jira" stranded next to no button is worse than nothing. Verified as a PDF: a filled
retro lands on one page with nothing clipped.

### Motion and states

One clock for the whole form: `--duration-form` (120ms) and `--ease-form`. 120ms sits at the fast
end of the productivity-UI band deliberately — these controls are touched hundreds of times in a
sitting, and at that frequency motion is fatigue, not delight. Fields transition border,
background and colour (listed, never `all`, so the autosizing textareas do not animate their
height on every keystroke) and resolve to ink on hover. Select and Popover fade in over 100ms and
close instantly; exits stay subtler than entrances, and neither slides or scales. Reduced motion
is handled once, globally, for the CSS-driven remainder auto-animate does not already cover.

### Favicon

`public/favicon.svg` — a black-on-white ticked checkbox, square corners, no colour. Inline SVG only;
no `.ico` fallback and no external assets.

### Output format

Matches the boss's real letter, verbatim (the sample below is checked in as
`src/lib/__fixtures__/rex-retro-31.txt` and asserted byte-for-byte by the format tests):

```
Rex Retro #31
Goals
Investor FUP DONE
K/O money flow USA chart WIP
July Metrics DONE
Kenny (how to demo value) WIP
How to solve sales in Australia WIP

Commitment 7
Complete 6

Comments
We need Cash contributions from our partners
July Metric has dropped to 67% from our target of 80%
JM still away
Sales is an issue
Investor said no, but no good reason given
Great feedback from Amanda re: Rex need and solution fit

Pluses
July leak figured out (mostly)
Made progress “6” completion

Improvements
Cut back Lux time on this until we get paid
```

Rules the template encodes:

- The `Goals` label sits **directly under the title**, with no blank line between them.
- Goal status is an **uppercase token**: `DONE`, `WIP`, or `NOT DONE` (three states — a goal
  nobody started is a real retro outcome). Position is a user setting, **after** the goal text by
  default (as above) or **before** it (`DONE Investor FUP`); the setting is stored in
  `localStorage` and applies identically to the plain, HTML and `mailto:` output.
- Points are **two lines**, `Commitment N` then `Complete N`. Either is omitted when blank.
- Every section is skipped entirely — its blank separator line included — when it is empty.

- **Copy** writes BOTH `text/plain` (exactly the above) and `text/html` (same content) to the
  clipboard via `ClipboardItem`, so Apple Mail pastes rich and Notes/Slack paste clean. The HTML
  flavour renders each line as its own `<div>` and each blank line as an explicit
  `<div><br></div>` — never a CSS margin, because mail clients strip styles and would otherwise
  collapse the letter into one block.
- **Mail team** builds a `mailto:` URL — `to` from the recipients field, `subject` from the title,
  `body` from the plain-text output — and opens the default mail client. Plain text only; fine for
  retro-sized notes. If this disappoints in practice, milestone 3 adds real sending.

### Persistence

- Autosave the whole form to `localStorage` on input, keyed `retro:{teamId}:{sprintId}` (manual
  mode uses a `manual` sprint key). Restore on load. Remember last-used team.

## Configuration

`config/teams.json` (checked in — no secrets in it):

```json
{
  "teams": [
    {
      "id": "rex",
      "name": "Rex",
      "titleTemplate": "Rex Retro #{sprint}",
      "boardId": 12,
      "recipients": ["a@example.com", "b@example.com"]
    }
  ]
}
```

Board IDs are **pinned** here, discovered once at setup via `GET /rest/agile/1.0/board`
(boards are filter-based and can span projects; resolving from project keys at runtime invites
duplicates — research item 5).

Worker secrets (via `wrangler secret put`):

- `JIRA_SITE` — `https://{site}.atlassian.net`
- `JIRA_EMAIL` — the acting user's Atlassian email
- `JIRA_API_TOKEN` — **classic unscoped token** (scoped tokens can't reach the greenhopper
  velocity endpoint — research item 4)
- `JIRA_TOKEN_EXPIRY` — ISO date of the token's expiry (tokens now max out at 1 year; the UI
  shows a warning banner starting 30 days before expiry, and 401s render a "token expired?"
  message rather than a silent empty form)

## Server API routes

All routes call Jira server-side with Basic auth (`email:api_token`). Never expose the token or
proxy arbitrary paths.

| Route | Jira call(s) | Notes |
|---|---|---|
| `GET /api/sprints?team=` | `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,closed` | Sprint objects include `goal` already — no per-sprint fetch. Closed sprints sort oldest-first, so page via `isLast` to reach the latest; return the active sprint + last N closed. |
| `GET /api/velocity?team=` | `GET /rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId={boardId}` | Undocumented endpoint. Parse `velocityStatEntries[sprintId].estimated/.completed`. On any failure return `{available: false}` — the form leaves the points fields blank and the user types them. |
| `GET /api/velocity-report?team=` | `GET /rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId={boardId}` | The whole series for the report dialog: `[{sprintId, name, committed, completed}]`, oldest first. **Same single call** as `/api/velocity` — greenhopper returns all ~12 sprints at once, so the report costs no extra round trip. Ordering comes from the payload's own `sprints` array (newest-first on all three live boards) reversed; the entries dict is unordered and sprint ids do not increase with start date. A sprint with no entry is dropped, not zero-filled — an active sprint legitimately has none, and two zero bars would draw a catastrophe that never happened; a genuine 0/0 sprint is kept, because that is data. Same `{available:false}` degradation. |
| `POST /api/end-sprint` | `GET /rest/agile/1.0/board/{boardId}/sprint` (guard), then `POST /rest/agile/1.0/sprint/{sprintId}` `{"state":"closed"}` | **The only write.** Body is `{team, sprintId}`. See "Ending a sprint" below. |

`/api/velocity-report` is a separate route rather than a widened `/api/velocity` on purpose:
that route answers one sprint's two numbers, is called on every fill, and its response shape is
parsed field by field by the form. Making it carry twelve sprints the form throws away would
change a contract for no gain. Both hit the same greenhopper call and the same adapter; they
differ only in what they project out of it.

### Ending a sprint

The one Jira write the app makes, and the only irreversible thing it can do:
closing a sprint ends it for the whole team and sends unfinished issues back to the backlog.

Intended workflow: the boss reviews the board's tickets in Jira, ends the sprint from the form, and
the app refetches — the just-closed sprint becomes the selected one, now with a velocity snapshot
(Commitment/Complete), because Jira only computes those numbers at close.

**The Jira contract**, verified against the official Agile OpenAPI spec (path
`/rest/agile/1.0/sprint/{sprintId}`, operation *Partially update sprint*), not from memory:

- `POST` is a **partial** update — "fields not present in the request JSON will not be updated" — so
  `{"state": "closed"}` alone is the entire body. **No `startDate`/`endDate` passthrough is
  required.** That is only a concern for `PUT`, the *full* update, which nulls every field the body
  omits.
- "A sprint can be completed by updating the state to `closed`. This action requires the sprint to be
  in the `active` state. This sets the `completeDate` to the time of the request."

**Guards — nothing the client says is trusted.** Before any write is issued the route checks, in
order: the body parses as JSON; `team` is known and has a board; `sprintId` is a positive integer;
and then, server-side in `closeSprint`, that the sprint appears in *that team's own board listing*
and that the listing reports it as `active`. The last two are read from Jira rather than taken from
the request, so a sprint on another team's board, a nonexistent id, or a sprint that closed in
another tab is refused with a 400 and **the write endpoint is never called**. 401/403 map to the
token error; everything else surfaces as a clear failure.

**Permission:** closing a sprint requires the acting Jira user (`JIRA_EMAIL`) to hold the
**"Manage sprints"** project permission. Without it Jira returns 403, which the UI surfaces verbatim.

**Testing rule:** these are live team sprints — the happy path is never exercised against
`skillion.atlassian.net`. It is covered by unit tests against a fake Jira
(`src/lib/close-sprint.test.ts`), which assert the exact request body and that every refusal issues
zero POSTs. Only failure paths are checked live.

The UI shows **End sprint** as step 1's primary action only while the selected sprint is the
active one, behind the same in-place popover confirmation as Reset. On success the refetch and
reselect run **and the report dialog opens** — that is the "end the sprint, see the report right
here" moment.

Velocity is a **pluggable adapter with graceful degradation** by design: it works as of late 2025,
but Atlassian doesn't support it and no official alternative exists, and the report's numbers
cannot be faithfully recomputed from documented APIs (commitment is a sprint-start snapshot —
research item 3). If it ever dies, the tool degrades to "type two numbers", not to broken.

### Goal splitting

The sprint goal is effectively a single-line plain-text blob (multiline is an unfulfilled Jira
feature request). The splitter is forgiving: split on newlines if present, else on `;`, `•`, or
`1. 2. 3.`-style numbering, else treat the whole string as one goal row. Rows stay editable, so a
bad split costs one manual fix. **Verify against the real goal text from the boss's boards during
setup and tune the splitter.**

## Milestones

### M1 — manual form (useful on day one, no Jira, no secrets)

Form + done/wip toggles + paste-to-split + points fields + three textareas + Copy (plain+HTML) +
`mailto:` + localStorage + team config (titles/recipients only). Deploy behind Cloudflare Access.
This alone already beats Apple Notes: no manual prefix typing, one-click formatted copy, one-click
mail draft.

### M2 — Jira prefill

API routes above; sprint picker; goals + points prefill; token-expiry banner. **First task is a
smoke test** (a throwaway script hitting the real site) for each configured board:

1. Sprint listing returns `goal` as expected → confirm splitter behavior on real goal text.
2. Greenhopper velocity returns sane numbers → **this is unverified for team-managed
   (`type: "simple"`) boards** (research item 5). Any team-managed board that fails keeps blank,
   manually-typed points — the form doesn't care.

### M3 (optional, only if `mailto:` disappoints)

Server-side sending of the rich-HTML version — evaluate Cloudflare Email Service (native Worker
binding, no new vendor) before Resend. Adds a confirm-before-send preview since it sends directly
instead of opening a draft.

## Repo layout

```
config/teams.json
docs/PLAN.md
docs/research/jira-api-feasibility.md
src/pages/index.astro          # the page shell; the form itself is a React island
src/pages/api/sprints.ts
src/pages/api/velocity.ts
src/pages/api/velocity-report.ts # the full series behind the report dialog
src/pages/api/end-sprint.ts    # the only write: closes an active sprint (guarded)
src/components/RetroForm.tsx   # the whole form, one client:only island
src/components/ConfirmButton.tsx
src/components/GoalList.tsx
src/components/VelocityChart.tsx      # hand-rolled SVG paired-bar chart, no chart library
src/components/VelocityReportDialog.tsx
src/components/ui/             # shadcn components, restyled flat (incl. skeleton.tsx)
src/lib/jira.ts                # fetch wrapper: base URL, Basic auth, error mapping, GET+POST
src/lib/sprints.ts             # sprint listing, labels, and closeSprint + its guards
src/lib/velocity-adapter.ts    # greenhopper parsing (one sprint + full series), degradation
src/lib/format.ts              # form state -> plain text + HTML output (shared by Copy and mailto)
src/lib/split-goals.ts         # forgiving goal splitter (unit-tested)
src/test/                      # cloudflare:workers stub + API route tests
public/favicon.svg
vitest.config.ts               # aliases cloudflare:workers so routes are testable in Node
wrangler.jsonc
astro.config.mjs
```

## Open questions (answer during setup, none block M1)

1. How does the boss actually delimit multiple goals inside the single-line sprint goal field?
   (Determines splitter tuning — see M2 smoke test.)
2. Which of the ~4 spaces are team-managed vs company-managed? (Determines whether velocity
   prefill works per board.)
3. Real team names, board IDs, recipient lists for `config/teams.json`.

## Operational notes

- Jira API token must be rotated at least yearly (hard Atlassian limit since 2025). The
  `JIRA_TOKEN_EXPIRY` banner is the reminder mechanism; rotation = create new token + one
  `wrangler secret put`.
- Rate limits are a non-issue at retro cadence; still honor `Retry-After` on 429 in `jira.ts`.
- Greenhopper velocity only covers the last ~12 sprints. That is now the report dialog's whole
  window, which is fine — it is the same window Jira's own velocity report shows, so the view
  matches what the boss already reads. What it still rules out is a *longer* history: there is no
  supported way to get sprint 1 back once it has aged out, so don't build anything that needs
  one. The report degrades to `{available: false}` if greenhopper ever dies, exactly as the
  points prefill does.
