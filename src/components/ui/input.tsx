import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn Input, restyled for the printed form: square, no shadow, a solid grey
 * field rule instead of the stock soft border, and no coloured focus ring (the
 * global black outline covers focus for every control).
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 border border-field bg-paper px-2 py-1 text-[15px] text-ink outline-none',
        'placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
