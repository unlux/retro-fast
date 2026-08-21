import * as React from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
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
      className={cn(
        STATUS_WIDTH,
        'shrink-0 border px-0 py-1 text-center text-[0.6875rem] tracking-[0.06em] uppercase transition-colors',
        status === 'done' && 'border-ink bg-ink text-paper',
        status === 'wip' && 'border-field bg-paper text-ink',
        // "Not done" reads as an absence: struck through, greyed, so a glance
        // down the list separates it from WIP without relying on reading.
        status === 'not-done' && 'border-rule bg-paper text-muted line-through',
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
    next.splice(index + 1, 0, { text: '', status: 'wip' });
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
    return (
      <p className="m-0 text-[0.8125rem] text-muted italic">
        No goals yet. Add one, or paste a list below.
      </p>
    );
  }

  return (
    <ul ref={listRef} className="m-0 list-none p-0">
      {goals.map((goal, index) => (
        <li
          // Index keys are correct here: rows have no stable identity (two
          // goals can hold identical text) and edits are positional.
          key={index}
          className="flex items-center gap-2.5 py-1.5 [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule"
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
            className="h-8 flex-1 border-rule px-1 hover:border-muted focus:border-field"
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

          <Button
            variant="ghost"
            size="icon-sm"
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
