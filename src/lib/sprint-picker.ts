import { CLOSED_SPRINT_COUNT } from './sprints';

/**
 * Rows the step 1 sprint picker can show: the active sprint, the closed ones,
 * and manual entry.
 */
export const SPRINT_PICKER_ROWS = CLOSED_SPRINT_COUNT + 2;

/**
 * Height the picker reserves whether it is loading, full, or short of
 * sprints, so the status line and buttons below it never move. Each row is
 * 2.5rem with 0.375rem gaps, plus the extra 0.375rem that sets manual entry
 * apart. RetroForm and its server-rendered fallback both use it.
 */
export const SPRINT_PICKER_HEIGHT = `${
  SPRINT_PICKER_ROWS * 2.5 + (SPRINT_PICKER_ROWS - 1) * 0.375 + 0.375
}rem`;
