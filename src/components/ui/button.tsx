import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Button adapted to the app's Atlassian-token visual system.
 *
 * The variants follow Jira's hierarchy: blue primary, neutral secondary,
 * bordered quiet, and chromeless row actions. Focus is handled globally so
 * every interactive control gets the same token-driven outline.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border text-[0.8125rem] font-medium outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    // The control step of the radius scale (global.css) — same 6px as every
    // input, select trigger and textarea, so a button beside a field reads as
    // the same family of object.
    'rounded-[var(--radius-control)]',
    // One clock for every button, shared with the fields (see global.css).
    'transition-[background-color,border-color,color,opacity] duration-(--duration-form) ease-(--ease-form)',
    // A pointer, because these are things you press. The stock component
    // leaves the default arrow, which reads as inert next to real links.
    'cursor-pointer',
    // Disabled state keeps a visible boundary rather than relying on opacity.
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-rule disabled:bg-paper disabled:text-muted disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        /** The one filled button on the page. There should only ever be one. */
        default:
          'border-brand bg-brand text-paper hover:border-brand-hover hover:bg-brand-hover active:border-brand-pressed active:bg-brand-pressed',
        /** Ordinary secondary action, matching Jira's neutral button. */
        outline:
          'border-transparent bg-neutral text-ink hover:bg-neutral-hover active:bg-neutral-pressed',
        /** Lower-priority action with no fill until hovered. */
        quiet:
          'border-rule bg-paper text-ink hover:border-field hover:bg-neutral active:bg-neutral-hover',
        /** No chrome at all, for row-level controls like "remove goal". */
        ghost:
          'border-transparent bg-transparent text-muted hover:bg-neutral hover:text-ink active:bg-neutral-hover',
        link: 'border-transparent text-brand underline underline-offset-4 hover:text-brand-hover',
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
