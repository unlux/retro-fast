import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Button, restyled for the printed form.
 *
 * Modified from the stock component: square instead of `rounded-md`, no
 * `shadow-xs`, no soft focus halo (the global black outline in global.css
 * handles focus for every control at once), and the variants remapped from the
 * default primary/secondary/accent palette onto the two-colour ink-on-paper one.
 * The `destructive` variant is gone — nothing here deletes anything a
 * confirmation step doesn't already cover — and `quiet` replaces it as the
 * default weight for secondary actions.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[0.8125rem] outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    // One clock for every button, shared with the fields (see global.css).
    'transition-[background-color,border-color,color,opacity] duration-[--duration-form] ease-[--ease-form]',
    // A pointer, because these are things you press. The stock component
    // leaves the default arrow, which reads as inert next to real links.
    'cursor-pointer',
    // Disabled is stated in the ink language rather than by fading alone:
    // half-opacity grey on white is close to invisible on this palette.
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-rule disabled:bg-paper disabled:text-muted disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        /** The one filled button on the page. There should only ever be one. */
        default: 'border-ink bg-ink text-paper hover:bg-[#262626] active:bg-[#404040]',
        /** Ordinary weight: black rule, white fill. */
        outline: 'border-ink bg-paper text-ink hover:bg-[#f2f2f2] active:bg-[#e5e5e5]',
        /** Secondary actions: grey rule and grey text until hovered. */
        quiet:
          'border-field bg-paper text-muted hover:border-ink hover:text-ink active:bg-[#f2f2f2]',
        /** No chrome at all, for row-level controls like "remove goal". */
        ghost: 'border-transparent bg-transparent text-muted hover:text-ink active:bg-[#f2f2f2]',
        link: 'border-transparent text-ink underline underline-offset-4 hover:decoration-2',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1.5 px-3',
        xs: 'h-6 gap-1 px-2 text-xs',
        icon: 'size-9',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'outline',
  size = 'default',
  asChild = false,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // The page has no <form> and nothing submits, so an unlabelled button
      // defaulting to type="submit" can only cause a stray reload.
      {...(asChild ? {} : { type })}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
