import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';

/**
 * Dialog, styled for the printed form.
 *
 * Built on **Base UI**, for the same reason the Select and Popover are (see the
 * long note at the top of `select.tsx`): it locks scroll on `<html>` and holds
 * the scrollbar gutter open with `scrollbar-gutter: stable` for the duration,
 * rather than removing the scrollbar and paying the freed width back with
 * injected `!important` body padding. A modal is the *worst* place to get that
 * wrong — the whole page is visible behind the backdrop, so a sideways slide of
 * everything underneath is impossible to miss.
 *
 * The composition follows Base UI's own parts rather than shadcn's flattened
 * one: Root / Portal / Backdrop / Viewport / Popup. `Viewport` is the part that
 * matters here — it is the scrollable positioning container, which is what lets
 * a twelve-sprint report scroll on a phone without the popup itself scrolling
 * away from the viewport. `Close` is rendered inside `Popup` deliberately: with
 * `modal` (the default) a touch screen reader has no other way out.
 */

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * Backdrop, viewport and popup in one element, so call sites stay a single
 * `<DialogContent>`.
 *
 * The backdrop is a wash rather than the usual heavy scrim: the form behind it
 * is the context for the numbers in front, and blacking it out would say the
 * report replaced the page instead of annotating it.
 */
function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className={cn(
          'fixed inset-0 z-50 bg-[var(--ds-blanket,rgba(9,30,66,0.54))]',
          // Same restrained fade as the Select and Popover, on the same clock.
          // No blur: a blurred backdrop is a compositing cost paid to make the
          // page behind look like frosted glass, which is not a paper idiom.
          'transition-opacity duration-100 ease-[--ease-form]',
          'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        )}
      />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        // The scroll happens here, not inside the popup, so on a phone the
        // whole sheet — heading, chart and table — scrolls as one document.
        // `items-start` rather than `items-center`: a tall report centred in a
        // short viewport puts its own title off-screen above the fold.
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 max-sm:p-2"
      >
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            // The surface step of the radius scale: this is the page's one
            // genuine card, and it contains controls that carry the 6px step.
            'relative my-auto w-full max-w-[52rem] rounded-[var(--radius-surface)] border border-rule bg-paper p-6 text-ink shadow-[var(--ds-shadow-overlay,0_8px_12px_rgba(9,30,66,0.15))] outline-none max-sm:p-4',
            'transition-opacity duration-100 ease-[--ease-form]',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 text-base font-semibold tracking-[0.01em]', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('m-0 text-[0.8125rem] text-muted', className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
