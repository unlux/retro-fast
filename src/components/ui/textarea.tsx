import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn Textarea, restyled for the printed form and made to grow with its
 * content rather than ever scrolling.
 *
 * Restyling: the 6px control radius, no shadow, solid grey field rule, no
 * coloured focus ring.
 *
 * Autosizing is the substantive change. A retro's comments run to a dozen
 * lines, and a fixed-height box that scrolls hides half of what you just wrote
 * exactly when you want to reread it. Two mechanisms, deliberately:
 *
 *   - `field-sizing: content` (global.css, behind `@supports`) does it natively
 *     in Chromium with no measurement and no reflow.
 *   - Everywhere else, the layout effect below sets an explicit pixel height
 *     from `scrollHeight`. It runs on every value change and on window resize,
 *     because wrapping — and therefore height — depends on the width.
 *
 * `overflow-hidden` is what actually guarantees "never scrollable": with the
 * height always at least `scrollHeight`, there is nothing to scroll, and if a
 * measurement is ever momentarily wrong the box grows instead of clipping.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const resize = React.useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Native sizing is in charge here; touching `style.height` would fight it.
    if (CSS.supports?.('field-sizing', 'content')) return;
    // Collapse first: `scrollHeight` never shrinks below the current height, so
    // without this the box would only ever grow, never shrink back on delete.
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  // Layout effect, not effect: resizing after paint shows one frame at the
  // wrong height every time a draft is restored.
  React.useLayoutEffect(resize, [resize, props.value]);

  React.useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  return (
    <textarea
      data-slot="textarea"
      data-autosize=""
      ref={ref}
      rows={props.rows ?? 3}
      onInput={(event) => {
        resize();
        props.onInput?.(event);
      }}
      className={cn(
        'block w-full resize-none overflow-hidden rounded-[var(--radius-control)] border border-field bg-input px-2.5 py-2 text-sm text-ink outline-none',
        'placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
