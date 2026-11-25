/**
 * Rows the step 1 sprint picker shows before it scrolls. The list holds the
 * active sprint, the recent closed ones and manual entry; only the newest
 * few are worth a glance, so the rest stay one scroll away.
 */
export const SPRINT_PICKER_VISIBLE_ROWS = 5;

/**
 * Fixed height of the picker's scroll box, loading or loaded, full or short of
 * sprints, so the status line and buttons below it never move. Each row is
 * 2.5rem with 0.375rem gaps, plus 0.25rem of padding on each side so a focused
 * row's outline isn't clipped by the scroll box. RetroForm and its
 * server-rendered fallback both use it.
 */
export const SPRINT_PICKER_HEIGHT = `${
  SPRINT_PICKER_VISIBLE_ROWS * 2.5 + (SPRINT_PICKER_VISIBLE_ROWS - 1) * 0.375 + 0.5
}rem`;
