import * as React from 'react';
import { Check, X } from 'lucide-react';

import { SortableList, SortableRow } from '@/components/SortableList';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moveBauItem, newBauItem, type BauChecks, type BauItem } from '@/lib/bau';
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
 *
 * ## The same control, without the ticks
 *
 * The Plan tab edits next sprint's copy of the standing list, for a sprint that
 * has not started: there is nothing to tick yet, and the push sends every item
 * unticked regardless. So the ticks are optional. Leave `onChecksChange` out
 * and the checkbox column is not rendered at all, rather than drawn and ignored
 * — a box that does nothing is worse than no box. Text editing, adding and
 * removing work identically in both places.
 */

export interface BauListProps {
  items: BauItem[];
  onItemsChange: (items: BauItem[]) => void;
  /**
   * This sprint's ticks. Both or neither: with `onChecksChange` absent the list
   * is text-only and the checkbox column is not rendered (the Plan tab).
   */
  checks?: BauChecks;
  onChecksChange?: (checks: BauChecks) => void;
  /**
   * Ids of items that just arrived from a Jira fill or a "move to BAU" click.
   * Their rows get a brand-tinted wash that fades once the caller clears the
   * set — the list sits below the goals, so without the wash a fill that lands
   * six items here is invisible from where the eye is.
   */
  highlightIds?: ReadonlySet<string>;


}

export function BauList({
  items,
  checks = {},
  onItemsChange,
  onChecksChange,
  highlightIds,
}: BauListProps) {
  const tickable = onChecksChange !== undefined;
  /**
   * The list's own root. The focus lookup below is scoped to it because the
   * retro and the plan each mount one of these and both stay in the DOM while
   * the other tab is hidden; a document-wide query would find the retro's
   * inputs first and focus a row nobody can see.
   */
  const rootRef = React.useRef<HTMLDivElement>(null);
  /** Which row to focus after the next render — see GoalList for why. */
  const focusRow = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (focusRow.current === null) return;
    const index = focusRow.current;
    focusRow.current = null;
    const inputs = rootRef.current?.querySelectorAll<HTMLInputElement>('[data-bau-input]');
    inputs?.[index]?.focus();
  });

  const update = (index: number, text: string) => {
    onItemsChange(items.map((item, i) => (i === index ? { ...item, text } : item)));
  };

  const toggle = (item: BauItem) => {
    if (!onChecksChange) return;
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
    // Without ticks there is nothing to drop; a tick the retro still holds for
    // an id that no longer exists is inert, because ids are never reused.
    if (item && onChecksChange && checks[item.id]) {
      const next = { ...checks };
      delete next[item.id];
      onChecksChange(next);
    }
    focusRow.current = items.length <= 1 ? null : Math.min(index, items.length - 2);
  };

  /** Alt+arrow keys in the text field remain a keyboard shortcut. */
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    focusRow.current = target;
    onItemsChange(moveBauItem(items, index, target));
  };

  return (
    <div ref={rootRef}>
      {items.length === 0 ? (
        /* Same ruled band as the empty goal list, so the two read as siblings. */
        <p className="m-0 flex min-h-11 items-center rounded-[var(--radius-control)] border border-dashed border-rule px-2.5 text-[0.8125rem] text-muted">
          {tickable
            ? 'No BAU items yet. Fill goals from Jira fills this list too, or add one below.'
            : 'No BAU items yet. Add the work that repeats every sprint.'}
        </p>
      ) : (
        <SortableList items={items} onChange={onItemsChange}>
        <ul className="m-0 list-none p-0">
          {items.map((item, index) => {
            const checked = checks[item.id] === true;
            const fresh = highlightIds?.has(item.id) === true;
            return (
              <SortableRow key={item.id} id={item.id} label={item.text || `BAU item ${index + 1}`} className={cn("py-1.5", fresh && "bg-brand-soft")}>
                {/*
                  A real checkbox, drawn in ink. `appearance-none` strips the OS
                  control and the tick is an overlaid icon, so the box matches
                  the form's palette instead of the platform's accent colour.
                */}
                {tickable && (
                  <span className="relative inline-flex size-8 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      data-bau-checkbox=""
                      checked={checked}
                      onChange={() => toggle(item)}
                      aria-label={`${item.text || `BAU item ${index + 1}`} — done this sprint`}
                      className={cn(
                        'peer size-[1.125rem] cursor-pointer appearance-none rounded-[var(--radius-control)] border bg-paper',
                        'transition-[background-color,border-color] duration-(--duration-form) ease-(--ease-form)',
                        'border-field hover:border-brand checked:border-success checked:bg-success',
                      )}
                    />
                    <Check
                      aria-hidden="true"
                      className="pointer-events-none absolute size-3 text-paper opacity-0 peer-checked:opacity-100"
                      strokeWidth={3}
                    />
                  </span>
                )}

                <Input
                  data-bau-input=""
                  value={item.text}
                  placeholder="RFP"
                  aria-label={`BAU item ${index + 1} text`}
                  // Matches the goal rows' quieter field: a column of
                  // full-strength boxes is a wall.
                  className={cn(
                    'h-8 min-w-0 flex-1 border-rule px-1',
                    // A ticked item is done; greying it lets a glance down the
                    // list separate what is left from what is finished.
                    checked && 'text-muted',
                  )}
                  onChange={(event) => update(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.altKey && event.key === 'ArrowUp') {
                      event.preventDefault();
                      move(index, -1);
                      return;
                    }
                    if (event.altKey && event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(index, 1);
                      return;
                    }
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
              </SortableRow>
            );
          })}
        </ul>
        </SortableList>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-print-hide>
        <Button variant="quiet" onClick={add}>
          Add BAU item
        </Button>
        <span className="text-[0.8125rem] text-muted">
          {tickable
            ? 'Saved for this Space across sprints. The ticks are just for this sprint.'
            : 'Next sprint’s copy of the retro’s list. Edits here leave the retro alone.'}
        </span>
      </div>
    </div>
  );
}
