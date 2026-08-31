import * as React from 'react';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';

import { cn } from '@/lib/utils';

/**
 * shadcn ToggleGroup on the Base UI primitive, restyled for the printed form.
 *
 * A segmented band in the form's hairline vocabulary: one bordered group at
 * the control radius, items divided by the same rule, quiet until selected.
 * What a selected item looks like is the call site's decision — status
 * segments tint by status, so no pressed style is baked in here beyond the
 * resting ink.
 *
 * Base UI, not Radix, because every primitive in this app is (see select.tsx);
 * the group is single-select by default and its value is always an array.
 * Roving focus and arrow keys come from the primitive.
 */

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        'flex items-stretch overflow-hidden rounded-[var(--radius-control)] border border-rule',
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        'flex flex-1 cursor-pointer items-center justify-center border-0 bg-transparent text-muted',
        'transition-[background-color,color] duration-(--duration-form) ease-(--ease-form)',
        'hover:text-ink',
        // The divider between segments, in the group's own rule.
        '[&+&]:border-l [&+&]:border-rule',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
