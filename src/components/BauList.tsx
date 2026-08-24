import * as React from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newBauItem, type BauChecks, type BauItem } from '@/lib/bau';
import { cn } from '@/lib/utils';

/**
 * The BAU checkbox list.
 *
 * Two different lifetimes are being edited in one row, which is the whole
 * subtlety of this control:
 *
 *   - The **checkbox** answers "did we do this *this sprint*", and is thrown
 *     away when the next sprint starts.
 *   - The **text** is part of the team's standing list and outlives every
 *     sprint; editing or removing it changes what the team is asked about from
 *     now on.
 *
 * Nothing in the UI shouts about that distinction — a row is a checkbox and
 * some text, which is what a checkbox list is — but the copy under the list
 * says it once, because "remove" here is a bigger deal than removing a goal
 * row and somebody should be told that exactly once.
 *
 * Deliberately a real `<input type="checkbox">` rather than a styled button:
 * the semantics are exactly a checkbox's, so the platform's own control gets
 * the keyboard behaviour, the announcement and the tap target right for free.
 * It is `appearance-none` and drawn in the form's ink, matching the goal rows'
 * status chip rather than the OS blue.
 */

export interface BauListProps {
  items: BauItem[];
  checks: BauChecks;
  onItemsChange: (items: BauItem[]) => void;
  onChecksChange: (checks: BauChecks) => void;
}

export function BauList({ items, checks, onItemsChange, onChecksChange }: BauListProps) {
  const [listRef] = useAutoAnimate<HTMLUListElement>();
  /** Which row to focus after the next render — see GoalList for why. */
  const focusRow = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (focusRow.current === null) return;
    const index = focusRow.current;
    focusRow.current = null;
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-bau-input]');
    inputs[index]?.focus();
  });

  const update = (index: number, text: string) => {
    onItemsChange(items.map((item, i) => (i === index ? { ...item, text } : item)));
  };

  const toggle = (item: BauItem) => {
    const next = { ...checks };
    if (next[item.id]) delete next[item.id];
    else next[item.id] = true;
    onChecksChange(next);
  };

  const add = () => {
    focusRow.current = items.length;
    onItemsChange([...items, newBauItem('')]);
  };

  const insertAfter = (index: number) => {
    const next = [...items];
    next.splice(index + 1, 0, newBauItem(''));
    focusRow.current = index + 1;
    onItemsChange(next);
  };

  const remove = (index: number) => {
    const item = items[index];
    onItemsChange(items.filter((_, i) => i !== index));
    // Drop the tick with the item, or a re-added item with a recycled id
    // would arrive pre-ticked. Ids are unique, so this only ever clears one.
    if (item && checks[item.id]) {
      const next = { ...checks };
      delete next[item.id];
      onChecksChange(next);
    }
    focusRow.current = items.length <= 1 ? null : Math.min(index, items.length - 2);
  };

  return (
    <div>
      {items.length === 0 ? (
        /* Same ruled band as the empty goal list, so the two read as siblings. */
        <p className="m-0 flex min-h-11 items-center rounded-[var(--radius-control)] border border-dashed border-rule px-2.5 text-[0.8125rem] text-muted">
          No repeatable goals yet. Add work that recurs every sprint.
        </p>
      ) : (
        <ul ref={listRef} className="m-0 list-none p-0">
          {items.map((item, index) => {
            const checked = checks[item.id] === true;
            return (
              <li
                // The item's own id, never the array index — see the long note
                // in GoalList: with index keys the wrong row animates away.
                key={item.id}
                className="group flex items-center gap-2.5 py-1.5 [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule"
              >
                {/*
                  A real checkbox, drawn in ink. `appearance-none` strips the OS
                  control and the tick is an overlaid icon, so the box matches
                  the form's palette instead of the platform's accent colour.
                */}
                <span className="relative inline-flex size-8 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    data-bau-checkbox=""
                    checked={checked}
                    onChange={() => toggle(item)}
                    aria-label={`${item.text || `BAU item ${index + 1}`} — done this sprint`}
                    className={cn(
                      'peer size-[1.125rem] cursor-pointer appearance-none rounded-[var(--radius-control)] border bg-paper',
                      'transition-[background-color,border-color] duration-[--duration-form] ease-[--ease-form]',
                      'border-field hover:border-brand checked:border-success checked:bg-success',
                    )}
                  />
                  <Check
                    aria-hidden="true"
                    className="pointer-events-none absolute size-3 text-paper opacity-0 peer-checked:opacity-100"
                    strokeWidth={3}
                  />
                </span>

                <Input
                  data-bau-input=""
                  value={item.text}
                  placeholder="RFP"
                  aria-label={`BAU item ${index + 1} text`}
                  // Matches the goal rows' quieter field: a column of
                  // full-strength boxes is a wall.
                  className={cn(
                    'h-8 flex-1 border-rule px-1',
                    // A ticked item is done; greying it lets a glance down the
                    // list separate what is left from what is finished.
                    checked && 'text-muted',
                  )}
                  onChange={(event) => update(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    insertAfter(index);
                  }}
                />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 hover:text-warn"
                  aria-label={`Remove ${item.text || `BAU item ${index + 1}`} from the standing list`}
                  onClick={() => remove(index)}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-print-hide>
        <Button variant="quiet" onClick={add}>
          Add repeatable goal
        </Button>
        <span className="text-[0.8125rem] text-muted">
          Saved for this Space across sprints. The ticks are just for this sprint.
        </span>
      </div>
    </div>
  );
}
