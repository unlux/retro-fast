import { describe, expect, it } from 'vitest';
import { formatRecipients, isEmailAddress, parseRecipients } from './recipients';

describe('parseRecipients', () => {
  it('accepts commas, semicolons and newlines', () => {
    expect(parseRecipients('a@example.com; b@example.com\nc@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });

  it('trims, drops blanks and removes case-insensitive duplicates', () => {
    expect(parseRecipients(' A@example.com, ,a@example.com; b@example.com ')).toEqual([
      'A@example.com',
      'b@example.com',
    ]);
  });
});

describe('formatRecipients', () => {
  it('writes one predictable comma-separated value', () => {
    expect(formatRecipients([' a@example.com ', 'b@example.com', 'A@example.com'])).toBe(
      'a@example.com, b@example.com',
    );
  });
});

describe('isEmailAddress', () => {
  it.each(['pete@example.com', 'first.last+retro@example.co.uk'])('accepts %s', (address) => {
    expect(isEmailAddress(address)).toBe(true);
  });

  it.each(['', 'pete', 'pete@', '@example.com', 'pete @example.com'])(
    'rejects %p',
    (address) => {
      expect(isEmailAddress(address)).toBe(false);
    },
  );
});
