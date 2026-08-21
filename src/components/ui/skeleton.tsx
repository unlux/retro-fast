import { cn } from "@/lib/utils"

/**
 * shadcn Skeleton, restyled for the printed form.
 *
 * Stock ships `bg-accent animate-pulse rounded-md` — a rounded grey lozenge
 * that throbs. On a page whose entire visual argument is "this is a printed
 * form" that reads as a different product. So: the form's own 6px control
 * radius rather than shadcn's larger one, the same
 * hairline grey as the rules between sections, and a slow, shallow fade instead
 * of the default pulse. It should look like an unfilled field on a paper form,
 * not like a loading widget.
 *
 * The animation is dropped entirely under `prefers-reduced-motion`, where a
 * flat grey block is a perfectly good placeholder on its own.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Not `aria-hidden`: a skeleton conveys "content is coming", and the
      // regions using it carry their own `aria-busy`/status text for that.
      // Hiding it outright would leave a screen reader with a silent gap.
      aria-hidden="true"
      className={cn(
        // Same 6px as the control each skeleton stands in for, so the
        // placeholder is the shape of the thing arriving, not a bare slab.
        "rounded-[var(--radius-control)] bg-rule/70 motion-safe:animate-skeleton-fade",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
