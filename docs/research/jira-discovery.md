# Jira live discovery — skillion.atlassian.net

Discovery date: 2026-08-20. Live API calls against the real site, auth via Basic
(`lakshay@skillionvision.com` + classic API token). All data below is real production data as of
this date — treat sprint numbers/goals as a snapshot, not permanent.

---

## 1. All boards

`GET /rest/agile/1.0/board?maxResults=50` returned `total: 21`, `isLast: true` in one page — this
is the complete board list, no further pagination needed.

| id | name | type | project (key) |
|----|------|------|----------------|
| 23 | TOUR board | scrum | Tours Classic (TOUR) |
| 27 | Product Engineering | scrum | SCRUM-X(QK+TOURS) (SCRUMX) |
| 26 | SCRUM-X board | scrum | SCRUM-X(QK+TOURS) (SCRUMX) |
| 7 | TOURS board | simple | (DEPRECATED) Tours (TOURS) |
| 11 | CS board | simple | COVID SteriSafe (STERISAFE) |
| 12 | FCDW board | simple | FLEX Car Dealer Workflows (FLEX) |
| 15 | FM board | scrum | Fleet Management Classic (FM) |
| 16 | HDC board | scrum | Helmet Detection Classic (HDC) |
| 17 | MDC board | scrum | COVID Mask Detection Classic (MDC) |
| 18 | HEC board | scrum | Hawk Eye Classic (HEC) |
| 22 | CD board | scrum | QuietKat (QK) |
| 21 | SCRUM-Y board | scrum | SCRUM-Y(HE+FMD) (SCRUMY) |
| 29 | CTRL Aero 1.5 | simple | CTRL-Aero (AERO) |
| 30 | HE board | simple | Hawkeye (HE) |
| 31 | CTRL Pro board | simple | CTRL-Pro (CTRLPRO) |
| 32 | HEAL board | simple | Health (HEAL) |
| 33 | SKILLIONX board | simple | SkillionX (SKILLIONX) |
| 134 | REXBUG board | simple | Reconexa Bug Tracker (REXBUG) |
| **66** | **CLIN board** | **simple** | **Reconexa (REX)** |
| **101** | **SKIL board** | **simple** | **Skillion Marketing (SKIL)** |
| **167** | **SL board** | **simple** | **Skillion Labs (SL)** |

### Mapping to the three teams we care about

The task description said "~4 spaces total" for Rex / Skillion Labs / Marketing, but the full board
list has **21 boards across many more than 4 projects** (this site hosts several unrelated legacy
product projects: Tours, SteriSafe, FLEX, Fleet Management, Helmet/Mask/Hawk-Eye Classic, QuietKat,
CTRL-Aero/Pro, Health, SkillionX). Only three boards match the requested teams by name:

- **Rex → board id 66**, "CLIN board", project **Reconexa (REX)**, type `simple`.
- **Skillion Labs → board id 167**, "SL board", project **Skillion Labs (SL)**, type `simple`.
- **Marketing → board id 101**, "SKIL board", project **Skillion Marketing (SKIL)**, type `simple`.

**Flagging one ambiguity I did not resolve silently:** there is a second Reconexa-named project,
**board id 134 "REXBUG board"**, project "Reconexa Bug Tracker (REXBUG)", also `type: simple`. I
tested it: `GET /rest/agile/1.0/board/134/sprint?state=active` returns
`{"errorMessages": ["The board does not support sprints"]}` — it's a bug-tracking board with no
sprint feature enabled, so it cannot be the retro board and **board 66 is the unambiguous Rex
choice**. Flagging this rather than silently picking 66, since REXBUG could confuse a future reader
of `config/teams.json` grepping for "REX".

No other boards had names/projects resembling "Rex", "Skillion Labs", or "Marketing" — the mapping
above is complete and unambiguous once REXBUG is ruled out by the sprint-support check.

---

## 2. Sprints per board — active + 2 most recently closed, verbatim goals

For each board: `?state=active` (single result, parallel sprints not in use), and `?state=closed`
paged to `isLast: true` to get the true most-recent tail (closed sprints sort oldest-first, exactly
as the feasibility doc predicted).

### Board 66 — Rex (Reconexa)

Closed sprint count: 31 (`isLast` walk: `startAt=29&maxResults=50` → last page).

| id | name | state | start | end | goal (JSON-escaped, verbatim) |
|----|------|-------|-------|-----|-------------------------------|
| 3595 | REX Sprint 32 | active | 2026-08-20T15:20:46.044Z | 2026-08-27T02:24:00.000Z | `"Investor new outreach\nWorkflow USA chart\nEmail to Caroline re' investment\nKenny (how to demo value)"` |
| 3592 | REX Sprint 31 | closed | 2026-08-12T16:21:54.084Z | 2026-08-20T02:24:00.000Z | `"Investor FUP\nK/O money flow USA chart\nJuly Metrics\nKenny (how to demo value)\nHow to solve sales in Australia"` |
| 3587 | REX Sprint 30 | closed | 2026-08-06T00:52:22.168Z | 2026-08-13T02:24:00.000Z | `"Investor meeting\nMeet with Caroline\nCliniko App submission\nComplete the cost breakdown"` |

Goal delimiter observed: **`\n` (newline) between each bullet, consistently**, one goal fragment
per line, no trailing punctuation convention, no numbering.

### Board 167 — Skillion Labs

Closed sprint count: 11 (`isLast` walk: `startAt=9&maxResults=50` → last page).

| id | name | state | start | end | goal (JSON-escaped, verbatim) |
|----|------|-------|-------|-----|-------------------------------|
| 3591 | SL Sprint 12 | active | 2026-08-13T16:18:55.992Z | 2026-08-19T04:00:00.000Z | `"RFP#3\nWhy emails are not working?\nYT channel subs?\nPM for the RFQ work interview\nWhy did Google Drive remove files?\nMap out the Skillion Intern Idea\nK/O the Vexletic project\nSkillion Bikes Case #3"` |
| 3589 | SL Sprint 11 | closed | 2026-08-06T01:13:57.710Z | 2026-08-12T04:00:00.000Z | `"RFP#2 submission\nLIN Ads running and testing\nSEO Tools\nOutreach (OEMs)\nR&D Tax submission"` |
| 3586 | SL Sprint 10 | closed | 2026-07-30T01:57:11.949Z | 2026-08-05T04:00:00.000Z | `"FUP in the 2 RFP's we questioned - urgently\nSubmit the 2 RFP's we questioned before the deadline\nSupport Mamal leading the RFP's\nSubmit to the other Primes & FUP with BA\nSubmit a proposal for Marco\nLIN Ads\nCase #3 for Skillion Bikes\nSort and list the next RFP's Folyo\nTake a ticket to learn the ecosystem\nStripe: fill out the form"` |

Goal delimiter observed: **`\n`-delimited**, same pattern as Rex. Note (from the velocity payload,
not shown in the table above but worth flagging for the splitter): **older Skillion Labs sprints
(e.g. SL Sprint 4, id 3536) mix plain `\n` bullets with an embedded pseudo-XML block**, e.g.:

```
"...Metricool WIP\n\n<ambition>\nReview Googles AI advertising offer NOT\nAI level up sales material (1 pager, scripts) NOT\n...Sales focus WIP"
```

— a literal `<ambition>` tag line appears mid-goal with trailing "NOT"/"WIP"/"NO" annotations per
line. This is historical (not in the active/2-latest-closed set above) but confirms the splitter
must be tolerant of arbitrary free text, not just clean bullets.

### Board 101 — Marketing (Skillion Marketing / SKIL)

Closed sprint count: 30 (`isLast` walk: `startAt=28&maxResults=50` → last page).

| id | name | state | start | end | goal (JSON-escaped, verbatim) |
|----|------|-------|-------|-----|-------------------------------|
| 3596 | SKIL Sprint 31 | active | 2026-08-20T17:10:07.200Z | 2026-08-27T04:00:00.000Z | `"Google Workspace set up\nReview the Meeting with Dangaal for content improvement strategies\nFBook Ads test\nReview website copy\nRFP leads K/O\nHawkeye OEMs K/O\nTikTok start posting (download/remove)\nTest Rahul and Tirza with a long video\nPlan the YT channel using advertising\nPlan the Google Search Ads\nBAU (business as usual)\n- [ ] Podcast\n- [ ] Video Content\n- [ ] DMs\n- [ ] Blogs (handover to MY)\n- [ ] Case Study #4\n- [ ] LIN text posts"` |
| 3590 | SKIL Sprint 29 | closed | 2026-08-07T14:44:33.871Z | 2026-08-13T04:00:00.000Z | `"Is email marketing working?\nHow to grow the channels\nHow to use Alignable\nIncrease the LIN text posts to 5/week\nLawyers in NYC\nHawkeye OEMs\nRFP leads\nFBook Ads\nLIN Ads test performance\nBe more specific about the ticket descriptions\nDecision needed\t\n\tEmail marketing\n\tTikTok\n\tHow to grow the channels\n\tAutomations page revisit\n\tRFP email ideas\nQualified leads!\n\nBAU\nPodcast, \nContent,\nDMs"` |
| 3594 | SKIL Sprint 30 | closed | 2026-08-14T16:47:15.728Z | 2026-08-20T04:00:00.000Z | `"FBook Ads\nReview website copy\nRFP leads\nEmail marketing improvements\n5 hot tips to improve the social media channels\nIncrease the LIN text posts to 5/week\nHawkeye OEMs\nDecision TikTok\nTest Rahul and Tirza with a long video\nCan we grow the YT channel using advertising\nDecide on Google Search or YT ads\nBAU\n- [ ] Podcast, \n- [ ] Video Content\n- [ ] DMs\n- [ ] Blogs\n- [ ] Case Study\n- [ ] LIN text posts"` |

Goal delimiter observed: **`\n`-delimited**, but the Marketing board is the outlier — it regularly
embeds **Markdown checkbox sub-bullets** (`- [ ] Podcast`) as a "BAU" sub-list, and Sprint 29 shows
**tab-indented sub-bullets** (`\t\tEmail marketing`) under a "Decision needed" line, plus blank
lines (`\n\n`) as visual separators. **Splitter implication:** a naive `split('\n')` on the
Marketing board goal will produce checkbox/tab-prefixed fragments and empty-string rows from blank
lines — the splitter needs to (a) drop empty lines after splitting, and (b) probably strip leading
`- [ ] ` / `\t` markers rather than treat them as separate top-level goals, or accept that these
rows need one manual edit each (acceptable per PLAN.md's "bad split costs one manual fix" design,
but worth knowing this board hits that path routinely, not rarely).

**Cross-board summary for the splitter:** newline is the dominant, reliable delimiter across all
three boards — no `;`, `•`, or `1. 2. 3.` numbering seen anywhere in the live data. The forgiving
fallback splitter in PLAN.md is unlikely to ever be exercised for these three teams; the main
real-world tuning need is filtering blank lines and deciding how to treat markdown-checkbox /
tab-indented sub-bullets (Marketing board only).

---

## 3. Velocity endpoint smoke test

`GET /rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId={boardId}` — tested against all three
target boards (all `type: "simple"`, i.e. team-managed) plus one `type: "scrum"` (company-managed)
board as a control.

| board id | team | board type | HTTP status | sprint ids match Agile API? |
|----------|------|-----------|-------------|------------------------------|
| 66 | Rex | simple | **200** | yes |
| 167 | Skillion Labs | simple | **200** | yes |
| 101 | Marketing | simple | **200** | yes |
| 27 | (control: Product Engineering) | scrum | 200 | yes |

**This directly answers the open research question in PLAN.md and the feasibility doc: the
greenhopper velocity endpoint works for `type: "simple"` (team-managed) boards on this site**, not
just company-managed scrum boards as the official docs' "classic velocity chart" description
implied. All three target boards are team-managed and all three returned real, non-empty
`velocityStatEntries`.

Sample `velocityStatEntries` (2-3 most recent sprints per board; keys are sprint ids, matched
against the Agile API sprint ids above — confirmed identical, e.g. Rex sprint 3592/3587 appear with
the same ids in both APIs):

**Board 66 (Rex):**

| sprint id | name | estimated | completed |
|-----------|------|-----------|-----------|
| 3592 | REX Sprint 31 | 7.0 | 6.0 |
| 3587 | REX Sprint 30 | 5.0 | 2.0 |
| 3585 | REX Sprint 29 | 13.0 | 7.0 |

**Board 167 (Skillion Labs)** — the active sprint (3591) has no entry yet (not closed, no velocity
snapshot exists until close); the 2 most recently closed do:

| sprint id | name | estimated | completed |
|-----------|------|-----------|-----------|
| 3591 | SL Sprint 12 (active) | n/a — no entry (sprint not closed) | n/a |
| 3589 | SL Sprint 11 | 32.0 | 17.0 |
| 3586 | SL Sprint 10 | 32.0 | 30.0 |

(Note: the `velocityStatEntries` object is **not sorted by sprint id or recency** — it's a plain
dict. The adapter must look up by sprint id from the Agile API response, not assume ordering.
Each entry also carries `estimatedEntries`/`completedEntries` arrays of per-issue-key point values
— richer than needed; only the top-level `estimated.value`/`completed.value` are used.)

**Board 101 (Marketing)** — active sprint (3596) likewise has no entry yet:

| sprint id | name | estimated | completed |
|-----------|------|-----------|-----------|
| 3596 | SKIL Sprint 31 (active) | n/a — no entry (sprint not closed) | n/a |
| 3594 | SKIL Sprint 30 | 65.0 | 38.0 |
| 3590 | SKIL Sprint 29 | 82.0 | 51.0 |

**Action item for implementation:** since the raw JSON dict is unordered, `velocity.ts` must build
`{sprintId: {estimated, completed}}` and look up by the sprint id already known from the
`/board/{id}/sprint` call — never assume `velocityStatEntries` iteration order correlates with
recency. This is a minor addition to the adapter design in PLAN.md, not a blocker.

The `sprints` array inside the velocity response also independently repeats `goal` text per sprint
(as the feasibility doc's community-sourced shape predicted) — consistent with the Agile API goal
text for the same sprint id, cross-checked for Rex sprint 3592 and SL sprint 3586/3589 and SKIL
3590/3594 above (identical strings).

---

## 4. User emails

Tried `GET /rest/api/3/user/search?query={name}` and the fully paginated
`GET /rest/api/3/users/search` (all pages, filtered to `accountType == "atlassian"`).

| Requested name | Matched Jira user | accountId | emailAddress via API |
|-----------------|--------------------|-----------|------------------------|
| Peye | **no exact match** — closest plausible match by inference is **Pete Cooper** (nickname/typo guess; sprint goals across all three boards mention "Pete" repeatedly, e.g. Rex sprint 3534 goal "...Reconexa contact form forwards to Mitch (and Pete)...", SCRUM-X goal "Pete's return to the USA") | `5e827915db49780c148d2be5` | **hidden (empty string)** |
| Julian | Julian Meyer | `5e82795e1e9adc0c182e81fd` | **hidden (empty string)** |
| Manya | Manya Sharma | `712020:30a949bc-4827-4b3a-972b-ddb62b766807` | **hidden (empty string)** |
| Lakshay | Lakshay | `712020:d8a37324-d2dd-4d57-87af-6d8005113d17` | **lakshay@skillionvision.com** (visible — this is the authenticated user) |

**Flagging rather than guessing:** `query=Peye` returns zero results from both `user/search` and
`user/picker`, and "Peye" does not appear as a display name anywhere in the full 66-account
`users/search` listing. I did not find an account literally named "Peye". Pete Cooper is the only
name in the directory that's phonetically/contextually close and who shows up constantly in Rex/
Skillion Labs sprint goals as a teammate — but this is an inference, not a confirmed match. **Please
confirm whether "Peye" = Pete Cooper (or someone else entirely) before shipping the config.**

**Privacy note confirmed:** every account except the token owner (Lakshay) returns
`"emailAddress": ""` from every user endpoint tried (`user/search`, `users/search`, `user/picker`
returns no email field at all). This is Atlassian's per-user "who can see your contact info"
privacy setting, defaulted to private, and it cannot be bypassed by any read-scope this token has —
confirmed by testing `/rest/api/3/myself` (own email visible) vs. every other account (empty). None
of Pete Cooper's, Julian Meyer's, or Manya Sharma's emails could be retrieved via the Jira API.
These will need to come from another source (company directory, Slack, asking them directly) and
are marked as TODOs in the proposed config below.

---

## 5. Story point field ids

`GET /rest/api/3/field`, filtered to names containing "story point":

| field id | name | schema type / custom type |
|----------|------|------------------------------|
| `customfield_10026` | Story Points | `number` / `com.atlassian.jira.plugin.system.customfieldtypes:float` (classic company-managed field) |
| `customfield_10016` | Story point estimate | `number` / `com.pyxis.greenhopper.jira:jsw-story-points` (team-managed field) |

Matches the feasibility doc's prediction exactly (two distinct fields, company-managed vs
team-managed). Not needed for the primary path (all three target boards get points from the
working greenhopper velocity endpoint per section 3) — recorded only for the documented fallback
path per PLAN.md.

---

## PROPOSED `config/teams.json`

Board ids are pinned per section 1/2. Recipient emails are per the requested team assignment (rex +
skillion-labs → peye, lakshay, julian; marketing → peye, manya), but **all non-Lakshay emails are
unknown** (section 4) — every one of them is a TODO placeholder, not a guess. Do not ship this file
as-is; fill in the TODOs first.

```json
{
  "teams": [
    {
      "id": "rex",
      "name": "Rex",
      "titleTemplate": "Rex Retro — Sprint {sprint}",
      "boardId": 66,
      "recipients": [
        "TODO-peye@example.com",
        "lakshay@skillionvision.com",
        "TODO-julian@example.com"
      ]
    },
    {
      "id": "skillion-labs",
      "name": "Skillion Labs",
      "titleTemplate": "Skillion Labs Retro — Sprint {sprint}",
      "boardId": 167,
      "recipients": [
        "TODO-peye@example.com",
        "lakshay@skillionvision.com",
        "TODO-julian@example.com"
      ]
    },
    {
      "id": "marketing",
      "name": "Marketing",
      "titleTemplate": "Marketing Retro — Sprint {sprint}",
      "boardId": 101,
      "recipients": [
        "TODO-peye@example.com",
        "TODO-manya@example.com"
      ]
    }
  ]
}
```

TODO markers to resolve before shipping:

1. Confirm "Peye" = Pete Cooper (accountId `5e827915db49780c148d2be5`) or a different person —
   unresolved in section 4.
2. Get Pete Cooper's, Julian Meyer's, and Manya Sharma's email addresses from a non-Jira source
   (Atlassian privacy settings hide them from every API endpoint tried).
3. Confirm the two-letter `SL`/`SKIL`/`REX` team naming doesn't need adjustment in `titleTemplate`
   (used "Rex" / "Skillion Labs" / "Marketing" per the task's team names, not the Jira project
   display names, for readability in the emailed retro).
