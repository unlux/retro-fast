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
2. **Goals** — rows of goal text, each with a `done` / `wip` toggle in front. Prefilled from the
   sprint's `goal` field; rows are editable, deletable, addable, and a paste-box fallback splits
   pasted text into rows. Toggles are always manual (goals are free text; Jira has no status for
   them).
3. **Points** — `Completed: __ / Committed: __` number inputs, prefilled from the velocity report
   when available, always editable.
4. **Comments / Pluses / Improvements** — three plain textareas; each non-empty line becomes one
   line in the output.
5. **Actions** — **Copy** and **Mail team**, plus an editable recipients field prefilled from the
   team's config.

### Output format

Matches the boss's current Apple Notes template:

```
Rex Retro — Sprint 42

done Goal one text
wip  Goal two text

Completed: 29 / Committed: 34

Comments
First comment line
Second comment line

Pluses
...

Improvements
...
```

- **Copy** writes BOTH `text/plain` (exactly the above) and `text/html` (same content, bold
  heading and section labels) to the clipboard via `ClipboardItem`, so Apple Mail pastes rich and
  Notes/Slack paste clean.
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
      "titleTemplate": "Rex Retro — Sprint {sprint}",
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
src/pages/index.astro          # the form
src/pages/api/sprints.ts
src/pages/api/velocity.ts
src/lib/jira.ts                # fetch wrapper: base URL, Basic auth, error mapping
src/lib/velocity-adapter.ts    # greenhopper parsing, {available:false} degradation
src/lib/format.ts              # form state -> plain text + HTML output (shared by Copy and mailto)
src/lib/split-goals.ts         # forgiving goal splitter (unit-tested)
public/                        # nothing fancy; styles inline or one small css file
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
