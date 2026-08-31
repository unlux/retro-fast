# Jira Cloud API feasibility for retro-fast

Research date: 2026-08-20. Scope: server-side tool on Cloudflare Workers, acting as one Jira user
against one Jira Cloud site (2 teams, ~4 projects). Needs: sprint goal text, committed vs completed
story points per sprint (the Velocity report numbers).

All API-shape claims below were verified against fetched pages of the official docs or the official
OpenAPI spec (`https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json`), not training
data. Community threads are used only as status signals for undocumented endpoints and are marked
as such.

Verdict summary:

| # | Item | Verdict |
|---|------|---------|
| 1 | Sprint goal text via Agile API | POSSIBLE |
| 2 | List boards + sprints (active / latest closed) | POSSIBLE |
| 3 | Velocity numbers via greenhopper endpoint | POSSIBLE-BUT-RISKY |
| 4 | Basic auth with email + API token | POSSIBLE (annual token rotation now mandatory) |
| 5 | Team-managed vs company-managed gotchas | Mixed — see item 5; velocity path must be tested per board type |

---

## 1. Sprint goal text — POSSIBLE

**Endpoint:** `GET /rest/agile/1.0/sprint/{sprintId}`

The documented 200 example includes `goal`:

```json
{
  "id": 37,
  "self": "https://your-domain.atlassian.net/rest/agile/1.0/sprint/23",
  "state": "closed",
  "name": "sprint 1",
  "startDate": "2015-04-11T15:22:00.000+10:00",
  "endDate": "2015-04-20T01:22:00.000+10:00",
  "completeDate": "2015-04-20T11:04:00.000+10:00",
  "originBoardId": 5,
  "goal": "sprint 1 goal"
}
```

Source: [Sprint API group — Get sprint](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/#api-rest-agile-1-0-sprint-sprintid-get).
Access rule (documented on same page): the sprint is returned only if the user can view the board
the sprint was created on, or at least one issue in the sprint.

**No separate per-sprint fetch needed.** The board-scoped listing
`GET /rest/agile/1.0/board/{boardId}/sprint` returns full sprint objects *including `goal`* — the
documented example response in the official OpenAPI spec shows `"goal": "sprint 1 goal"` on each
element of `values`. Source: [swagger.v3.json](https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json),
path `/rest/agile/1.0/board/{boardId}/sprint`, and the rendered
[Board API group docs](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-sprint-get).

**Multiline / length:** the OpenAPI schema types `goal` as a plain `string` with **no `maxLength`
and no format constraint** (verified by grepping the spec). No documented length limit exists in
the endpoint docs either. The Jira UI treats the sprint goal as a single-line plain-text field;
multiline support is a long-standing open feature request, e.g.
[JSWSERVER-16161 "Sprint goal field does not support/handle multi-line texts"](https://jira.atlassian.com/browse/JSWSERVER-16161)
and [JSWSERVER-20433 "Sprint Goal should support multi line text input"](https://jira.atlassian.com/browse/JSWSERVER-20433).
Plan accordingly: treat `goal` as one plain-text blob; if users paste bullet lines into it, the API
returns whatever is stored, but do not *rely* on newlines being present. If the retro form wants
"goal lines", split on newlines when present and fall back to the whole string.

---

## 2. Listing boards and sprints — POSSIBLE

### Boards

**Endpoint:** `GET /rest/agile/1.0/board`

Relevant documented query params (from the OpenAPI spec and
[Board API group docs](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)):

- `projectKeyOrId` — "Filters results to boards that are relevant to a project. Relevance means
  that the jql filter defined in board contains a reference to a project."
- `type` — "Valid values: scrum, kanban, simple." (`simple` = team-managed/next-gen boards.)
- `name`, `startAt`, `maxResults`, `orderBy` (only `name`), `filterId` — note `filterId` is
  "Not supported for next-gen boards."

Response is the standard paged wrapper: `{ maxResults, startAt, total, isLast, values: [ { id, self, name, type } ] }`.

With only ~4 projects, calling this once per project key (or once unfiltered and matching locally)
is trivial. Filter `type=scrum` (and `simple` for team-managed) since kanban boards have no sprints.

### Sprints per board

**Endpoint:** `GET /rest/agile/1.0/board/{boardId}/sprint`

Documented params (OpenAPI spec, verified):

- `state` — "Filters results to sprints in specified states. Valid values: future, active, closed.
  You can define multiple states separated by commas, e.g. state=active,closed"
- `startAt`, `maxResults` — standard pagination.

**Documented sort order** (200 response description, quoted from the spec):

> "Sprints will be ordered first by state (i.e. closed, active, future) then by their position in
> the backlog."

So closed sprints come **first, oldest-first** — the *most recently closed* sprint is at the **end**
of the `state=closed` result set. Getting it requires paging to the last page. Practical recipe:

1. `?state=active&maxResults=1` → "the active sprint" (first page; with parallel sprints disabled
   there is at most one active sprint per board).
2. `?state=closed` → page forward until `isLast: true`, take the last element of `values`. If
   `total` is present in the response you can jump straight to `startAt = total - 1`, but the
   [pagination docs](https://developer.atlassian.com/cloud/jira/software/rest/intro/#pagination)
   warn that `total` "may not be included in the response, if it is too expensive to calculate",
   so keep the `isLast` walk as the fallback.

**maxResults caps:** the Agile API docs do not commit to a specific default or ceiling; the
pagination section explicitly says "Each API resource or method may have a different limit on the
number of items returned, which means you can ask for more than you are given" and "A client should
always assume that the requested page can be empty."
Source: [Jira Software Cloud REST intro — Pagination](https://developer.atlassian.com/cloud/jira/software/rest/intro/#pagination).
In practice the default page size is 50; do not hardcode an assumption — always drive paging off
`isLast`/returned counts.

Sprint objects carry `originBoardId`, so if a sprint shows up on more than one board you can
attribute it to the board it was created on.

---

## 3. Velocity report data — POSSIBLE-BUT-RISKY

### The greenhopper endpoint

**Endpoint (undocumented):** `GET /rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId={boardId}`

- **Not in any official Atlassian Cloud REST documentation.** Atlassian was asked to document the
  `rapid/charts` endpoints back in the Server era and closed the request as won't-do:
  [JSWSERVER-12877 "Update REST API doc with /rapid/charts endpoints"](https://jira.atlassian.com/browse/JSWSERVER-12877).
- **Status signal (community, Sept 2025):** it still functions on Jira Cloud, but **only returns
  the last 12 sprints**, and "there is no current, public, supported REST API endpoint to get the
  velocity report information" in the same shape. No Atlassian staff response in the thread.
  Source: [Alternative API for Velocity Chart (velocityStatEntries) in Jira Cloud](https://community.atlassian.com/forums/Jira-questions/Alternative-API-for-Velocity-Chart-velocityStatEntries-in-Jira/qaq-p/3116292)
  (answers dated 2025-09-23/24).
- **Response shape** (community-documented, not official — verify against your own site before
  building on it): a `sprints` array plus `velocityStatEntries`, an object keyed by sprint id with
  scope-snapshot-aware numbers:

```json
{
  "sprints": [ { "id": 123, "name": "Sprint 42", "state": "CLOSED", "goal": "..." } ],
  "velocityStatEntries": {
    "123": {
      "estimated": { "value": 34.0, "text": "34.0" },
      "completed": { "value": 29.0, "text": "29.0" }
    }
  }
}
```

  `estimated` = commitment at sprint start, `completed` = completed at sprint end — the same
  numbers the Velocity chart renders.

### The sprint report sibling

**Endpoint (undocumented):** `GET /rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId={boardId}&sprintId={sprintId}`

Status signal: a community thread from 2025-09-29 shows a user actively calling it on Jira Cloud
(large sprints even triggered generic rate limits), with a Community Leader replying "I believe the
old GreenHopper endpoints were sunset / unsupported long ago" — i.e. it works but is unsupported.
Source: [Rate Limit for /rest/greenhopper/1.0/rapid/charts/sprintreport in Jira Cloud](https://community.atlassian.com/forums/Jira-questions/Rate-Limit-for-rest-greenhopper-1-0-rapid-charts-sprintreport-in/qaq-p/3119515).

### Is there an official alternative? No.

- Searched the current Jira Software Cloud REST reference: no velocity/sprint-report/chart
  endpoints exist in the documented API surface
  ([API reference](https://developer.atlassian.com/cloud/jira/software/rest/), OpenAPI spec paths
  verified — only board/sprint/backlog/epic/issue CRUD-style resources).
- The [Atlassian Platform GraphQL API](https://developer.atlassian.com/platform/atlassian-graphql-api/)
  exists (gateway at `api.atlassian.com/graphql`, or `{site}.atlassian.net/gateway/api/graphql` for
  API-token auth), but its documented public surface does not include Jira board chart/velocity
  data; Jira's own frontend uses internal GraphQL that is not a supported public contract. Do not
  build on it.
- **You cannot faithfully recompute the Velocity numbers from documented issue APIs.** The
  Velocity chart's "Commitment" is a *snapshot of estimates at the moment the sprint starts*
  (scope changes after start excluded); "Completed" includes scope added mid-sprint. Sources:
  official chart docs
  ([View and understand the velocity chart](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-velocity-chart/))
  and a Dec 2025 community thread confirming API-recomputed totals mismatch the report because
  "Velocity relies on historical GreenHopper sprint snapshots, which are not fully exposed via
  current REST APIs"
  ([Velocity Report Story Point Mismatch vs API](https://community.atlassian.com/forums/Jira-questions/Is-the-Jira-Velocity-Report-Story-Point-Mismatch-vs-API-a-Known/qaq-p/3161611)).
  Approximations from issue changelogs (e.g. the open-source
  [jira-sprint-report](https://github.com/SYTrofimov/jira-sprint-report) approach) get close but
  are not guaranteed to equal the report.

**Auth for greenhopper:** these endpoints sit on the site domain (`{site}.atlassian.net/rest/greenhopper/...`)
and honor the same session/Basic credentials as other site REST resources; community usage in the
threads above is via normal API access on Cloud. There is no official statement — treat "works with
email+API token Basic auth" as expected-but-verify (item 4).

**Verdict: POSSIBLE-BUT-RISKY.** Works today (signals as recent as late 2025), gives exactly the
numbers we want including sprint id keying, but it is undocumented, officially unsupported,
Atlassian has declined to document it, and it is capped at the last ~12 sprints on Cloud. For this
tool ("active sprint" + "most recently closed sprint") the 12-sprint window is a non-issue. Build
it behind an adapter with graceful degradation (blank committed/completed fields in the form if the
endpoint disappears), and keep the changelog-recomputation approach in the back pocket.

---

## 4. Authentication — POSSIBLE (with annual token rotation)

**Method:** HTTP Basic auth, `email:api_token`, sent as an `Authorization: Basic <base64>` header.
Officially documented and explicitly recommended "for simple scripts and manual calls to the REST
APIs". Password Basic auth is deprecated; API tokens are the replacement.
Source: [Basic auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/).

**The token must be classic (unscoped) — tested, not assumed (2026-08-31).** Scoped API tokens
are credentials for the OAuth 2.0 bearer flow and are rejected by Basic auth on *every* route,
not merely the undocumented greenhopper one. A scoped token returned 401 on
`/rest/api/3/myself` — an endpoint that needs no scope at all — with
`x-seraph-loginreason: AUTHENTICATED_FAILED` and `www-authenticate: OAuth realm=…`, while the
classic token returned 200 against the same endpoint in the same minute. Because the failure is
at authentication rather than authorization, picking different scopes cannot help. The relevant
scope names, had it worked, would have been `read:sprint:jira-software`,
`write:sprint:jira-software` and `read:board-scope:jira-software`; recorded only so the next
person can see the option was explored and closed.

**Token expiry rules (the 2024–2025 change):**

- Tokens can be created with a lifetime of **1 day to 1 year — one year is the maximum**; new
  tokens default to one-year expiry (policy effective for tokens created after 2024-12-15).
- Pre-existing "immortal" tokens created before 2024-12-15 were retroactively assigned expiry
  dates (rollout after 2025-03-13).

Sources: [Manage API tokens for your Atlassian account](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
(current rules), [API tokens will now have a maximum one-year expiry](https://community.atlassian.com/forums/Jira-articles/API-tokens-will-now-have-a-maximum-one-year-expiry/ba-p/2880029)
(Atlassian announcement article). **Operational consequence: the tool's token must be rotated at
least yearly.** Put the expiry date somewhere visible and fail loudly on 401.

**Scoped vs unscoped tokens:** Atlassian now offers scoped API tokens (recommended), but scoped
tokens must call via `https://api.atlassian.com/ex/jira/{cloudId}/...` instead of the site URL
(same support page as above). The greenhopper endpoints are outside the scoped-token API surface
(scopes only cover documented REST APIs — e.g. `read:sprint:jira-software` and `read:board-scope:jira-software`
per the Agile API reference pages). **Use a classic unscoped token against the site URL** so one
credential covers both the Agile API and greenhopper. This is the one place where "most secure
option" and "works for everything we need" diverge; acceptable for a single-site internal tool.

*Confirmed empirically 2026-08-31*, and the constraint is stronger than written above: against
the site URL a scoped token fails **every** endpoint, not just greenhopper — 401 on
`/rest/api/3/myself`, which requires no scope, versus 200 for the classic token minutes apart.
Scoped tokens are OAuth bearer credentials; Basic auth rejects them before scopes are ever
considered. Adopting them is therefore not a token swap but an OAuth 2.0 3LO implementation,
*and* it would still leave greenhopper unreachable — so it buys nothing for this app.

**Permissions:** the acting user only needs to be able to view the boards/sprints (browse
permission on the projects). No admin rights needed for any read endpoint listed here.

**OAuth 2.0 (3LO):** not required. It exists for distributable apps; for a single-user internal
server-side tool, Basic + API token is the documented recommendation (see Basic auth page above).

**Rate limits:** per the official [rate limiting docs](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/),
API-token traffic is governed by burst limits (default GET 100 req/s per endpoint) — the new
points-based hourly quotas (enforcement from 2026-03-02) target Forge/Connect *apps*, and the page
states "API token-based traffic is not affected by this change, and will continue to be governed by
existing burst rate limits." A few requests per week is orders of magnitude below any limit. Still
honor `Retry-After` on 429 as the docs instruct.

**Cloudflare Workers note:** nothing exotic needed — plain `fetch` with an `Authorization` header;
no cookies, no IP allowlisting on Atlassian's side for token auth.

---

## 5. Load-bearing gotchas

### Team-managed (next-gen) vs company-managed — the big one

- The **Agile REST API works for both**: team-managed boards appear in `GET /rest/agile/1.0/board`
  as `type: "simple"` (documented valid value, see item 2), and their sprints come back through the
  same sprint endpoints. Only `filterId` filtering is documented as "Not supported for next-gen
  boards" ([OpenAPI spec](https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json)).
- The **Velocity chart is a company-managed feature**. The official docs for the classic velocity
  chart state it is only available in company-managed Scrum projects; team-managed projects have a
  *separate* "velocity report" implementation (commitment vs completed bars, story points or item
  count, subtasks excluded). Sources:
  [View and understand the velocity chart](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-velocity-chart/)
  (company-managed), [What is the velocity report? (team-managed)](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-next-gen-velocity-report/).
- Consequence: the greenhopper `rapid/charts/velocity` endpoint backs the *classic* chart. **Assume
  it works only for company-managed boards; whether it returns anything sane for a `simple` board
  is unverified** — no primary or community source found either way. This must be smoke-tested
  against the real site during setup. If any of the ~4 spaces is team-managed, its
  committed/completed numbers may have to come from the changelog-recomputation fallback (item 3)
  or be left blank.

### Story points field split

- Company-managed projects use the classic **"Story Points"** custom field; team-managed projects
  use a separate, locked **"Story point estimate"** field. Both exist site-wide with different
  custom field IDs (site-specific, e.g. `customfield_10016` vs `customfield_10026` — resolve via
  `GET /rest/api/3/field` at setup, never hardcode).
  Source (community, widely confirmed): [What is the difference between the 'Story Points' and 'Story point estimate' fields?](https://community.atlassian.com/forums/Jira-questions/What-is-the-difference-between-the-Story-Points-and-Story-point/qaq-p/903887).
- This only bites if we compute points from issues ourselves (the fallback path). The greenhopper
  velocity endpoint returns already-aggregated numbers using whatever estimation statistic the
  board is configured with, so the primary path is insulated from this.
- Also: a board's estimation statistic may not be story points at all (original time estimate,
  issue count, any numeric field — see velocity chart doc above). The tool should label the values
  "committed/completed (board estimation units)" rather than assuming points.

### Boards spanning multiple projects

Company-managed boards are saved-filter-based; one board can span several projects, and
`projectKeyOrId` filtering is by *relevance* ("the jql filter defined in board contains a reference
to a project" — OpenAPI spec). Two effects: (a) querying boards by project can return shared
boards multiple times across projects — de-duplicate by board id; (b) velocity numbers are
per-board, not per-project, and include all projects on the board. Since the tool's mental model is
"per team = per board", enumerate and pin **board ids** in config at setup time instead of
resolving from project keys on every run.

### Smaller items

- Sprints can be visible on multiple boards (issues from sprint X matching another board's filter);
  use `originBoardId` to attribute a sprint to its home board (field present in all sprint
  responses, item 1).
- The `state=closed` listing grows forever; latest-closed requires the `isLast` paging walk
  (item 2). With `total` present you can shortcut, but `total` is not guaranteed.
- Greenhopper velocity on Cloud only covers the last ~12 sprints (item 3) — fine for this tool,
  fatal if scope ever grows to "historical velocity trends".
- Requests hitting a just-closed sprint immediately after sprint completion may race the report
  snapshot; not documented for Cloud, low risk at weekly cadence, but retro prefill should be
  re-runnable.

---

## Plan impact

Things that change or constrain the plan:

1. **Annual credential rotation is now mandatory** (item 4). API tokens max out at 1 year. Store
   the expiry date, alert before it lapses, and make 401 failures loud. Not a design change, but an
   operational obligation that did not exist before 2025.
2. **Use an unscoped API token against the site URL**, not a scoped token (item 4) — scoped tokens
   route through `api.atlassian.com/ex/jira/{cloudId}`, cannot reach the greenhopper endpoints,
   and (verified 2026-08-31) are rejected by Basic auth on every route regardless of scope.
3. **The velocity numbers rest on an unsupported endpoint** (item 3). It works as of late 2025 and
   there is no official alternative, and the exact UI numbers *cannot* be recomputed from
   documented APIs (commitment is a sprint-start snapshot). Architect the velocity fetch as a
   pluggable adapter with graceful degradation (form still renders with goals but empty
   points if the endpoint dies), and accept that a changelog-based fallback is approximate.
4. **Team-managed spaces are the main open risk** (item 5). If any of the ~4 spaces is
   team-managed, greenhopper velocity for that board is unverified and may not work — smoke-test
   each board id during setup; be prepared to leave points blank or compute approximations for
   `simple`-type boards.
5. **Pin board ids in configuration** rather than deriving boards from project keys at runtime
   (multi-project boards, duplicate relevance matches — item 5).
6. **Sprint goal is effectively single-line plain text** (item 1) — design the "goal lines" form
   field to accept one blob, splitting on newlines opportunistically.
7. No blockers on the happy path: goals via the Agile API (single call per board, `goal` included
   in the sprint listing), boards/sprints listing with documented state filters and sort order, and
   rate limits are irrelevant at this volume.
