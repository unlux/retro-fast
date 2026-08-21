import * as React from 'react';

import { Button, type buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent } from '@/components/ui/popover';
import type { VariantProps } from 'class-variance-authority';

interface ConfirmButtonProps {
  children: React.ReactNode;
  /** The question, e.g. "Clear the draft for this team and sprint?" */
  question: string;
  /** Label on the affirmative button, e.g. "Reset". */
  confirmLabel: string;
  onConfirm: () => void;
  /**
   * When false the click runs straight through with no question. Used by
   * "Prefill from Jira", which only needs confirming when it would overwrite
   * something the user actually typed.
   */
  needsConfirm?: boolean;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  disabled?: boolean;
}

/**
 * A button that asks before doing something destructive, in place.
 *
 * Deliberately not `window.confirm`: a native dialog is a different visual
 * universe from this form, it blocks the whole tab, and on a page that
 * autosaves every keystroke it reads as far more alarming than the action
 * warrants. Deliberately not a modal either — the question belongs next to the
 * button that raised it, so the answer is one short pointer move away and the
 * form stays visible behind it.
 *
 * The popover is anchored to the button rather than replacing its label, so the
 * button doesn't change width mid-interaction and shift the row around it.
 */
export function ConfirmButton({
  children,
  question,
  confirmLabel,
  onConfirm,
  needsConfirm = true,
  variant = 'quiet',
  disabled,
}: ConfirmButtonProps) {
  const [open, setOpen] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  /**
   * Base UI positions against a ref rather than a wrapper element, so the
   * button itself is the anchor — no extra node around it, and the popover
   * still hangs off the button that raised the question.
   */
  const anchorRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Button
        ref={anchorRef}
        variant={variant}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (!needsConfirm) {
            onConfirm();
            return;
          }
          setOpen(true);
        }}
      >
        {children}
      </Button>
      <PopoverContent
        align="start"
        anchor={anchorRef}
        // Focus the safe option, not the destructive one: a stray Enter should
        // cancel, never confirm. Base UI takes the target as a ref directly,
        // where Radix needed the default focus move cancelled first.
        initialFocus={confirmRef}
      >
        <p className="m-0 mb-2.5">{question}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            ref={confirmRef}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
