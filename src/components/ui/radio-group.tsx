import * as React from 'react';
import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';

import { cn } from '@/lib/utils';

/**
 * Radio group on the Base UI primitive, styled as selectable rows.
 *
 * Each item is a whole `<label>` row with the radio dot at its left, so the
 * row is the click target and a short list reads at a glance without opening
 * anything. The group gives one tab stop and arrow-key movement; Base UI
 * renders `role="radio"` plus a hidden input, so screen readers announce a
 * real radio group.
 *
 * Keyboard focus rings the whole row, matching the outline global.css draws
 * on every other control.
 *
 * The selected row takes the brand rule and the soft selected wash. The label
 * reads its radio's `data-checked` through `has-[]`, so selection state lives
 * in one place: the primitive.
 */

function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.Props<string>) {
  return (
    <RadioGroupPrimitive<string>
      data-slot="radio-group"
      className={cn('grid gap-1.5', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  value,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'label'>, 'children'> & {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label
      data-slot="radio-group-item"
      className={cn(
        'flex min-h-10 min-w-0 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm text-ink',
        'transition-[background-color,border-color] duration-(--duration-form) ease-(--ease-form)',
        'hover:border-field',
        'has-[[data-checked]]:border-brand has-[[data-checked]]:bg-brand-soft',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ds-border-focused,#4688ec)]',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Root
        value={value}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border border-field bg-paper',
          'transition-[border-color] duration-(--duration-form) ease-(--ease-form)',
          'data-[checked]:border-brand',
        )}
      >
        <RadioPrimitive.Indicator className="size-2 rounded-full bg-brand" />
      </RadioPrimitive.Root>
      {children}
    </label>
  );
}

export { RadioGroup, RadioGroupItem };
