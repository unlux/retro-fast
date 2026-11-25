"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/**
 * Popover, restyled for the printed form: the 6px control radius, a solid black rule instead of
 * a soft border and drop shadow, and no zoom/slide entrance. It is used for the
 * in-place confirmations, where the point is a small panel of paper anchored to
 * the button — not a floating card.
 *
 * Built on **Base UI** rather than Radix because of how each locks scroll.
 * Radix's scroll lock (`react-remove-scroll`) sets `overflow: hidden` on
 * `body`, which removes the scrollbar, then pays the freed width back by
 * injecting `!important` body padding. That number has to be measured and
 * applied to the right box, and it fights any page rule on body padding. Base
 * UI locks `<html>`, the box that owns the viewport scrollbar, and sets
 * `scrollbar-gutter: stable` for the duration of the lock, so the width is
 * never freed and nothing is added back. docs/PLAN.md has the measurements.
 *
 * The exported names match the previous shadcn/Radix API so ConfirmButton did
 * not have to be rewritten around a new component shape. The one exception is
 * `PopoverAnchor`: Radix anchored by wrapping an element, Base UI anchors by
 * ref, so the wrapper is gone and callers pass `anchor={someRef}` to
 * `<PopoverContent>` instead. That is strictly less DOM.
 */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/**
 * The panel. Base UI splits Radix's `Content` into Positioner (placement) and
 * Popup (the visible box), so this wraps Portal/Positioner/Popup to keep the
 * single `<PopoverContent>` the call sites already use.
 */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  side,
  anchor,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  align?: React.ComponentProps<typeof PopoverPrimitive.Positioner>["align"]
  sideOffset?: React.ComponentProps<
    typeof PopoverPrimitive.Positioner
  >["sideOffset"]
  side?: React.ComponentProps<typeof PopoverPrimitive.Positioner>["side"]
  anchor?: React.ComponentProps<typeof PopoverPrimitive.Positioner>["anchor"]
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        side={side}
        anchor={anchor}
        className="z-50 outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-72 rounded-[var(--radius-surface)] border border-rule bg-paper p-3 text-[0.8125rem] text-ink shadow-[var(--ds-shadow-overlay,0_8px_12px_rgba(9,30,66,0.15))] outline-hidden",
            // A restrained fade: a short opacity ramp in,
            // nothing on the way out. A confirmation panel that bounces or
            // slides undercuts the seriousness of the question it is asking.
            "transition-opacity duration-100 ease-(--ease-form) data-[starting-style]:opacity-0",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
