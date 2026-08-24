import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRecipients, isEmailAddress, parseRecipients } from '@/lib/recipients';

export interface RecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}

export function RecipientsDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: RecipientsDialogProps) {
  const recipients = React.useMemo(() => parseRecipients(value), [value]);
  const [address, setAddress] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setAddress('');
    setError('');
  }, [open]);

  const addRecipient = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = address.trim();
    if (!isEmailAddress(next)) {
      setError('Enter a complete email address.');
      return;
    }
    if (recipients.some((recipient) => recipient.toLowerCase() === next.toLowerCase())) {
      setError('That address is already on the list.');
      return;
    }

    onChange(formatRecipients([...recipients, next]));
    setAddress('');
    setError('');
  };

  const removeRecipient = (addressToRemove: string) => {
    onChange(
      formatRecipients(
        recipients.filter(
          (recipient) => recipient.toLowerCase() !== addressToRemove.toLowerCase(),
        ),
      ),
    );
    setError('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[32rem]" aria-describedby="recipients-description">
        <DialogTitle>Mail recipients</DialogTitle>
        <DialogDescription id="recipients-description" className="mt-1.5">
          Mail team will address the draft to this list. Changes are saved for this Space in this
          browser.
        </DialogDescription>

        <div className="mt-6">
          <p className="m-0 mb-2 text-[0.8125rem] font-medium text-ink">Sending to</p>
          {recipients.length === 0 ? (
            <p className="m-0 rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-3 text-[0.8125rem] text-muted">
              Nobody yet. Add an address below.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {recipients.map((recipient) => (
                <li
                  key={recipient.toLowerCase()}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-rule bg-canvas px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-ink" title={recipient}>
                    {recipient}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={`Remove ${recipient}`}
                    title={`Remove ${recipient}`}
                    onClick={() => removeRecipient(recipient)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form className="mt-6" noValidate onSubmit={addRecipient}>
          <Label htmlFor="new-recipient">Add recipient</Label>
          <div className="flex items-start gap-2 max-sm:flex-col">
            <Input
              id="new-recipient"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="name@example.com"
              value={address}
              aria-invalid={error !== ''}
              aria-describedby="recipient-error"
              onChange={(event) => {
                setAddress(event.target.value);
                if (error !== '') setError('');
              }}
            />
            <Button type="submit" variant="outline" className="max-sm:w-full">
              Add
            </Button>
          </div>
          <p
            id="recipient-error"
            className="mt-1.5 mb-0 min-h-5 text-[0.8125rem] text-warn"
            role={error === '' ? undefined : 'alert'}
          >
            {error}
          </p>
        </form>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-rule pt-4">
          <span className="text-[0.8125rem] text-muted">
            {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
          </span>
          <DialogClose
            render={
              <Button variant="default">
                Done
              </Button>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
