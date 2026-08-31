/** Parse the separators accepted by the old free-form recipients field. */
export function parseRecipients(value: string): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const part of String(value ?? '').split(/[,;\n]/)) {
    const address = part.trim();
    const key = address.toLowerCase();
    if (address === '' || seen.has(key)) continue;
    seen.add(key);
    recipients.push(address);
  }

  return recipients;
}

/** One stable representation for drafts, localStorage and mailto generation. */
export function formatRecipients(recipients: string[]): string {
  return parseRecipients(recipients.join(', ')).join(', ');
}

/**
 * Deliberately modest validation. The browser still owns the email field, but
 * this catches missing domains and whitespace before an address reaches mailto.
 */
export function isEmailAddress(value: string): boolean {
  const address = String(value ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}
