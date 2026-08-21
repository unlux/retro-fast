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

Deliberately plain and formal: system font stack, black on white, thin rules between sections.

1. **Header** — team picker (dropdown from config), sprint picker (dropdown fed by Jira, defaults
   to the most recently closed sprint), and a free-text title field that composes the heading and
   email subject, e.g. `Rex Retro — Sprint 42`.
2. **Goals** — rows of goal text, each with a `done` / `wip` / `not done` status control. Prefilled from the
   sprint's `goal` field; rows are editable, deletable, addable, and a paste-box fallback splits
   pasted text into rows. Toggles are always manual (goals are free text; Jira has no status for
   them).
3. **Points** — `Completed: __ / Committed: __` number inputs, prefilled from the velocity report
   when available, always editable.
4. **Comments / Pluses / Improvements** — three plain textareas; each non-empty line becomes one
   line in the output.
5. **Actions** — **Copy** and **Mail team**, plus an editable recipients field prefilled from the
   team's config.

Also on the page: **End sprint**, shown only when the selected sprint is the active one (see
"Ending a sprint" below).

### Loading states

Every network wait is a **skeleton**, never a spinner: the sprint picker while the list loads, and
the goal rows and points inputs during a prefill. Each placeholder is sized to the control it
stands in for — the picker skeleton is `h-9` like the real trigger, the goal skeletons mirror
`GoalList`'s own row box — so the page does not move when the data lands. Verified in a headless
browser against a throttled server: section offsets, section heights and total document height are
byte-identical before and after the skeletons resolve. Labels stay visible throughout; only the
values are placeholders. The fade is dropped under `prefers-reduced-motion`.

### No layout shift from dropdowns

Radix locks scrolling while a Select or Popover is open. Left alone that removes the scrollbar and
shifts the page sideways for as long as the menu is open. Two lines in `global.css` fix it:
`scrollbar-gutter: stable` on `html` so the gutter is always reserved, and a
`body[data-scroll-locked]` rule restating the page's own horizontal padding. The second is
load-bearing and non-obvious — Radix writes the `padding` *shorthand*, so pinning only
`padding-right` fixes the compensation while silently zeroing `padding-left` and shifting everything
the other way. Both sides must be restated. Verified headlessly: opening either Select or the
confirm Popover moves tracked elements 0px.

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
| `POST /api/end-sprint` | `GET /rest/agile/1.0/board/{boardId}/sprint` (guard), then `POST /rest/agile/1.0/sprint/{sprintId}` `{"state":"closed"}` | **The only write.** Body is `{team, sprintId}`. See "Ending a sprint" below. |

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

The UI shows **End sprint** only while the selected sprint is the active one, behind the same
in-place popover confirmation as Reset.

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
src/pages/api/end-sprint.ts    # the only write: closes an active sprint (guarded)
src/components/RetroForm.tsx   # the whole form, one client:only island
src/components/ConfirmButton.tsx
src/components/GoalList.tsx
src/components/ui/             # shadcn components, restyled flat (incl. skeleton.tsx)
src/lib/jira.ts                # fetch wrapper: base URL, Basic auth, error mapping, GET+POST
src/lib/sprints.ts             # sprint listing, labels, and closeSprint + its guards
src/lib/velocity-adapter.ts    # greenhopper parsing, {available:false} degradation
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
- Greenhopper velocity only covers the last ~12 sprints — irrelevant for retros, fatal only if
  scope ever grows to historical velocity trends. Don't grow it that way.
