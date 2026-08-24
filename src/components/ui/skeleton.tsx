import { cn } from "@/lib/utils"

/**
 * A low-contrast placeholder shaped like the control it will replace.
 * Motion is removed globally under `prefers-reduced-motion`.
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
        "rounded-[var(--radius-control)] bg-[var(--ds-skeleton,#0515240f)] motion-safe:animate-skeleton-fade",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
