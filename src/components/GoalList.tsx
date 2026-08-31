import * as React from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Repeat, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  newGoal,
  STATUS_LABEL,
  STATUS_ORDER,
  type Goal,
  type GoalStatus,
  type StatusPosition,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/** How wide the status control is, so every goal's text starts on one line. */
const STATUS_WIDTH = 'w-[8.5rem] sm:w-[12rem]';

/** The active segment's voice, per status — the same palette the chip used. */
const ACTIVE_SEGMENT: Record<GoalStatus, string> = {
  done: 'font-semibold text-success',
  wip: 'font-semibold text-brand',
  // "Not done" reads as an absence: struck through, so a glance down the list
  // separates it from WIP without relying on reading.
  'not-done': 'font-semibold text-warn line-through',
};

/** The sliding thumb's wash, per status; the text tint lives on the segment. */
const THUMB_BG: Record<GoalStatus, string> = {
  done: 'bg-success-soft',
  wip: 'bg-brand-soft',
  'not-done': 'bg-warn-soft',
};

/** Short segment labels for narrow screens; full labels from `sm` up. */
const SHORT_LABEL: Record<GoalStatus, string> = {
  done: 'Done',
  wip: 'WIP',
  'not-done': 'Not',
};

/**
 * The status control: a segmented toggle group with all three states visible.
 *
 * This replaced a single cycling chip. The cycle was fast for walking a list
 * but showed one state at a time — the reader had to know the other options
 * existed and toggle through them to reach one. Segments put the whole menu
 * on the row: see the three states, press the one that is true.
 *
 * Built on the shadcn/Base UI ToggleGroup (see ui/toggle-group.tsx), which
 * supplies single selection, roving focus and the arrow keys. One guard on
 * top: the primitive lets a click on the selected item deselect to nothing,
 * and a goal always has a status, so an empty change is ignored.
 *
 * Only the selected segment carries `data-goal-status`; the other two are
 * `data-print-hide`, so a printed retro shows exactly the chosen state as a
 * flat chip — the content — rather than the whole control.
 */
function StatusControl({
  status,
  index,
  onChange,
}: {
  status: GoalStatus;
  index: number;
  onChange: (next: GoalStatus) => void;
}) {
  return (
    <ToggleGroup
      value={[status]}
      onValueChange={(value) => {
        const next = value[0] as GoalStatus | undefined;
        if (next && next !== status) onChange(next);
      }}
      aria-label={`Goal ${index + 1} status`}
      // h-8 matches the goal input beside it, so the row is one band rather
      // than two controls of slightly different heights. `relative` anchors
      // the sliding thumb below.
      className={cn(STATUS_WIDTH, 'relative h-8 shrink-0')}
    >
      {/*
        The selection wash is one element that travels, not three that swap:
        the highlight sliding from WIP to Done is what makes the state change
        legible as a movement rather than two unrelated color snaps. It rides
        `transform` (a third of the group per step, transition-retargetable
        mid-flight), recolors as it goes, sits under the segment dividers, and
        is pure decoration — hidden from print, where the flat chip is the
        content. Reduced motion keeps the color crossfade and drops the travel.
      */}
      <span
        aria-hidden="true"
        data-print-hide=""
        className={cn(
          'absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-[calc(var(--radius-control)-2px)] shadow-[0_1px_2px_rgba(9,30,66,0.18)]',
          'transition-[transform,background-color] duration-(--duration-move) ease-(--ease-move)',
          'motion-reduce:transition-[background-color]',
          THUMB_BG[status],
        )}
        style={{ transform: `translateX(${STATUS_ORDER.indexOf(status) * 100}%)` }}
      />
      {STATUS_ORDER.map((option) => {
        const active = option === status;
        return (
          <ToggleGroupItem
            key={option}
            value={option}
            {...(active ? { 'data-goal-status': option } : { 'data-print-hide': '' })}
            aria-label={`Goal ${index + 1}: ${STATUS_LABEL[option]}`}
            className={cn(
              // `relative` lifts the label above the absolutely-positioned
              // thumb, which would otherwise paint over static siblings.
              'relative px-1 text-[0.625rem] tracking-[0.05em] whitespace-nowrap uppercase',
              active && ACTIVE_SEGMENT[option],
            )}
          >
            <span className="max-sm:hidden">{STATUS_LABEL[option]}</span>
            <span className="sm:hidden">{SHORT_LABEL[option]}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export interface GoalListProps {
  goals: Goal[];
  statusPosition: StatusPosition;
  onChange: (goals: Goal[]) => void;
  /**
   * Move a row's text into the Space's standing BAU list, removing the row.
   * The escape hatch for standing work that arrived as a goal — the boss will
   * eventually write the BAU section in a fifth spelling the parser does not
   * know, and the repair should be one click, not delete-and-retype.
   */
  onMoveToBau?: (index: number) => void;
}

export function GoalList({ goals, statusPosition, onChange, onMoveToBau }: GoalListProps) {
  const [listRef] = useAutoAnimate<HTMLUListElement>();
  /**
   * Which row to focus after the next render. Adding or removing a row has to
   * move focus deliberately — React reuses DOM nodes, so without this the caret
   * silently lands on whatever text moved into the old position.
   */
  const focusRow = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (focusRow.current === null) return;
    const index = focusRow.current;
    focusRow.current = null;
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-goal-input]');
    inputs[index]?.focus();
  });

  const update = (index: number, patch: Partial<Goal>) => {
    onChange(goals.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)));
  };

  const insertAfter = (index: number) => {
    const next = [...goals];
    next.splice(index + 1, 0, newGoal(''));
    focusRow.current = index + 1;
    onChange(next);
  };

  const remove = (index: number) => {
    const next = goals.filter((_, i) => i !== index);
    // Land on the row that took the deleted one's place, or the new last row
    // when the end was removed; null when nothing is left.
    focusRow.current = next.length === 0 ? null : Math.min(index, next.length - 1);
    onChange(next);
  };

  if (goals.length === 0) {
    /*
     * The empty state is a ruled band, not a floating sentence: it holds the
     * space the list will occupy, so adding the first goal does not make the
     * page lurch, and it reads as the blank field on a form that it is.
     */
    return (
      <p className="m-0 flex min-h-11 items-center rounded-[var(--radius-control)] border border-dashed border-rule px-2.5 text-[0.8125rem] text-muted">
        No goals yet. Add one, or paste a list below.
      </p>
    );
  }

  return (
    <ul ref={listRef} className="m-0 list-none p-0">
      {goals.map((goal, index) => (
        <li
          /*
           * The goal's own id, never the array index.
           *
           * With index keys React reuses each <li> for whatever goal slides
           * into that slot, so deleting row 2 of 5 unmounts row 5 — and row 5
           * is then the only node auto-animate sees leaving. The list appeared
           * to close the gap instantly and then animate the wrong row away.
           * Keyed by id, the deleted row is the node that actually leaves, so
           * it fades out in place while the rows below slide up.
           *
           * `?? index` is the last-resort fallback for a goal that reached the
           * list without one; every creation path mints an id and `withGoalIds`
           * backfills restored drafts, so it should never be reached.
           */
          key={goal.id ?? index}
          className="group flex items-center gap-2.5 py-1.5 [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule"
        >
          {statusPosition === 'before' && (
            <StatusControl
              status={goal.status}
              index={index}
              onChange={(status) => update(index, { status })}
            />
          )}

          <Input
            data-goal-input=""
            value={goal.text}
            aria-label={`Goal ${index + 1} text`}
            // A goal row's field is quieter at rest than the standalone inputs
            // — a list of eight full-strength boxes is a wall — but it resolves
            // to the same ink on hover as every other field, rather than
            // stopping at grey. Focus is the global black outline.
            className="h-8 flex-1 border-rule px-1"
            onChange={(event) => update(index, { text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              insertAfter(index);
            }}
          />

          {statusPosition === 'after' && (
            <StatusControl
              status={goal.status}
              index={index}
              onChange={(status) => update(index, { status })}
            />
          )}

          {onMoveToBau && (
            /*
              Same quiet ghost as Remove, resolving to brand rather than warn:
              the row is not being destroyed, it is being reclassified as
              standing work. Sits before Remove so the destructive control
              keeps the end of the row, where it is everywhere else.
            */
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8 hover:text-brand"
              aria-label={`Move goal ${index + 1} to BAU — repeats every sprint`}
              onClick={() => onMoveToBau(index)}
            >
              <Repeat />
            </Button>
          )}

          {/*
            Quiet until you reach for it, then oxblood — the page's one accent,
            already the colour of the warning banner, so "this removes
            something" is said in a language the form already speaks. `size-8`
            matches the row's other controls and clears the 24px tap minimum.
          */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-8 hover:text-warn"
            aria-label={`Remove goal ${index + 1}`}
            onClick={() => remove(index)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
