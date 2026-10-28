# Guided sprint review

Retrofast shows one step at a time, with Back and Continue controls.

1. Choose the space and sprint. Manual entry remains available when Jira is unavailable.
2. Complete the sprint in Jira. Continue verifies closure. Points are fetched later when entering numbers and notes. Saved closed-sprint drafts keep edited totals. Manual retros rely on the user's confirmation via Continue.
3. View the velocity report inline, with chart and sprint totals. It loads on entering this step after closure.
4. Review goals and BAU. New goals have no selected status. Each non-empty goal needs an explicit Done, WIP, or Not done choice. Drag handles reorder goals while keeping their outcomes. BAU sits below goals, with drag handles that preserve this sprint's ticks.
5. Enter numbers and notes. Entering this step automatically refreshes points from Jira, with the reviewed goals and BAU outcomes visible above the fields. Unavailable points leave manual entries intact.
6. Preview and send the retro. Mail team is the primary action and opens the user's email app; Copy is secondary. Status always precedes goal text.
7. Plan the next sprint. Unfinished goals are added automatically to an existing plan without replacing other work or repeating matching lines. A Sonner toast at the top center confirms the fill. Goals and BAU have drag handles with mouse, touch hold, and keyboard support. Edits and order stay in next sprint's copy.
8. Preview and push. The target is the last future sprint in Jira's board order. A short confetti burst celebrates a confirmed successful push, with no animation for reduced motion. Restoring a saved success does not replay the burst. After success, return to Jira to check the tickets and start the sprint.

## Writing the plan

`POST /api/push-plan` accepts the configured team ID, goal text, expected sprint ID or null, and expected goal text. The server re-reads the board before writing. If the target or its goal has changed, it returns 409 with the current target so the user can review again. Existing goals require an editable merge preview.

Only if no future sprint exists does the server create one, including the goals in that single Jira request. Repeating an identical successful push does not write again. The browser also saves a successful-push receipt so revisiting an appended plan does not append it again. Failed reads never trigger creation. Sprint listings that exceed the pagination limit fail instead of returning partial results.

These are application checks, not a Jira transaction. Jira has no compare-and-swap guarantee here; changes made concurrently between the final read and write remain a limitation. No app action closes a sprint or moves its tickets.

The older create-sprint endpoint also checks for an existing future sprint before creating one. The old end-sprint backend is retained but has no caller in the interface.

## Verification

- `npm test` covers formatting, request guards, existing sprint reuse, creation with goals, target conflicts, and retry behavior.
- `npx tsc --noEmit` checks TypeScript.
- `npm run build` and `npm run test:initial-html` check the production artifact and loading fallback.
- `scripts/plan-mode-check.mjs` exercises the eight steps with fake Jira responses. It also exposes `--fixture-script` and `--browser-script` for running the same checks in T3's collaborative browser.

The app keeps existing draft keys. Reloading returns to step one while preserving per-sprint review data and per-space plans. Saved historical WIP choices stay intact; newly imported, pasted, or added goals start unreviewed. No paid email service is configured.
