import * as React from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ArrowUp, Check, X } from 'lucide-react';

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
 *
 * ## The same list, without the ticks
 *
 * The Plan tab edits the *same* standing list, but for a sprint that has not
 * started: there is nothing to tick yet, and the push sends every item unticked
 * regardless. So the ticks are optional. Leave `onChecksChange` out and the
 * checkbox column is not rendered at all, rather than drawn and ignored — a box
 * that does nothing is worse than no box. Text editing, adding and removing
 * work identically in both places, because it is one list.
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
  /**
   * Send an item back up to the goal list, removing it here. The return leg
   * of the goal rows' "move to BAU": a misfiled item — or a misclick — comes
   * back with one click instead of delete-and-retype.
   */
  onMoveToGoal?: (index: number) => void;
  /**
   * Last sprint's ticks, rendered as a read-only outcome beside each row.
   *
   * The Plan tab's answer to "what was there last month": the list itself is
   * carried forward, so it already says *what* was standing; this says which of
   * it actually happened. Strictly display — never pushed, never edited.
   *
   * A missing key reads "not done", which covers both an item that was there
   * and unticked and one added since. The second case is still true: it was
   * not done last sprint because it did not exist.
   */
  previousChecks?: BauChecks;
  /** The sprint those outcomes came from, named in each row's label. */
  previousLabel?: string | null;
}

export function BauList({
  items,
  checks = {},
  onItemsChange,
  onChecksChange,
  highlightIds,
  onMoveToGoal,
  previousChecks,
  previousLabel,
}: BauListProps) {
  const tickable = onChecksChange !== undefined;
  const showPrevious = previousChecks !== undefined;
  const previousName = previousLabel?.trim() || 'last sprint';
  const [listRef] = useAutoAnimate<HTMLUListElement>();
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
        <ul ref={listRef} className="m-0 list-none p-0">
          {items.map((item, index) => {
            const checked = checks[item.id] === true;
            const fresh = highlightIds?.has(item.id) === true;
            return (
              <li
                // The item's own id, never the array index — see the long note
                // in GoalList: with index keys the wrong row animates away.
                key={item.id}
                className={cn(
                  'group flex items-center gap-2.5 py-1.5 [&+&]:border-t [&+&]:border-dotted [&+&]:border-rule',
                  // A colour wash, not motion, so it also reads under reduced
                  // motion; the slow transition is the fade-out when the caller
                  // clears the highlight set.
                  'transition-colors duration-1000',
                  fresh && 'bg-brand-soft duration-150',
                )}
              >
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

                {showPrevious && (
                  /*
                    Last sprint's outcome, stated in words rather than as a
                    second checkbox: a box here would read as something to
                    click, and this is the one thing in the row that cannot be.
                    A newly added item is unticked by construction, which is
                    true — it was not done last sprint because it did not exist.
                  */
                  <span
                    className={cn(
                      'shrink-0 text-[0.75rem] whitespace-nowrap',
                      previousChecks[item.id] === true ? 'text-success' : 'text-muted',
                    )}
                    title={`${previousName}: ${
                      previousChecks[item.id] === true ? 'done' : 'not done'
                    }`}
                  >
                    {previousChecks[item.id] === true ? '✓ done' : '— not done'}
                  </span>
                )}

                {onMoveToGoal && (
                  /*
                    The return leg of the goal rows' Repeat action, in the same
                    quiet ghost-to-brand voice: nothing is destroyed, the row
                    goes back up to being a goal.
                  */
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 hover:text-brand"
                    aria-label={`Move ${item.text || `BAU item ${index + 1}`} back to the goal list`}
                    onClick={() => onMoveToGoal(index)}
                  >
                    <ArrowUp />
                  </Button>
                )}

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
          Add BAU item
        </Button>
        <span className="text-[0.8125rem] text-muted">
          {tickable
            ? 'Saved for this Space across sprints. The ticks are just for this sprint.'
            : 'One list per Space, shared with the retro. Edits here change it there too.'}
        </span>
      </div>
    </div>
  );
}
