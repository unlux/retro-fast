import * as React from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  newGoal,
  nextStatus,
  STATUS_LABEL,
  STATUS_ORDER,
  type Goal,
  type GoalStatus,
  type StatusPosition,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/** How wide the status control is, so every goal's text starts on one line. */
const STATUS_WIDTH = 'w-[5.5rem]';

/**
 * The three-state status control.
 *
 * A click cycles done -> wip -> not done, which is the fast path when you are
 * walking a list. But a three-state cycle is a bad *only* affordance — reaching
 * "done" from "not done" takes two clicks and there is no way to see the
 * options — so the control is also a real listbox: arrow keys and Home/End pick
 * a state directly, and every state is announced.
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
    <button
      type="button"
      // Not a listbox role: this is a cycling button, and claiming to be a
      // listbox without a popup misleads a screen reader more than it helps.
      // Lets the print stylesheet flatten the filled "Done" chip to an outline.
      data-goal-status={status}
      className={cn(
        STATUS_WIDTH,
        // h-8 matches the goal input beside it, so the row is one band rather
        // than two controls of slightly different heights.
        'h-8 shrink-0 rounded-[var(--radius-control)] border px-0 text-center text-[0.6875rem] tracking-[0.06em] uppercase',
        'transition-[background-color,border-color,color] duration-[--duration-form] ease-[--ease-form]',
        status === 'done' && 'border-ink bg-ink text-paper hover:bg-[#262626]',
        status === 'wip' && 'border-field bg-paper text-ink hover:border-ink',
        // "Not done" reads as an absence: struck through, greyed, so a glance
        // down the list separates it from WIP without relying on reading.
        status === 'not-done' &&
          'border-rule bg-paper text-muted line-through hover:border-field hover:text-ink',
      )}
      aria-label={`Goal ${index + 1} status: ${STATUS_LABEL[status]}. Change.`}
      onClick={() => onChange(nextStatus(status))}
      onKeyDown={(event) => {
        const at = STATUS_ORDER.indexOf(status);
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(STATUS_ORDER[(at + 1) % STATUS_ORDER.length]!);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(STATUS_ORDER[(at - 1 + STATUS_ORDER.length) % STATUS_ORDER.length]!);
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(STATUS_ORDER[0]!);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(STATUS_ORDER[STATUS_ORDER.length - 1]!);
        }
      }}
    >
      {STATUS_LABEL[status]}
    </button>
  );
}

export interface GoalListProps {
  goals: Goal[];
  statusPosition: StatusPosition;
  onChange: (goals: Goal[]) => void;
}

export function GoalList({ goals, statusPosition, onChange }: GoalListProps) {
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
