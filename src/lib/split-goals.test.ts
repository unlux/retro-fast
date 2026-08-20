import { describe, expect, it } from 'vitest';
import { splitGoals } from './split-goals';

describe('splitGoals', () => {
  it('returns nothing for blank input', () => {
    expect(splitGoals('')).toEqual([]);
    expect(splitGoals('   \n  \n ')).toEqual([]);
  });

  it('treats a plain sentence as one goal', () => {
    expect(splitGoals('Ship the onboarding revamp')).toEqual(['Ship the onboarding revamp']);
  });

  it('keeps hyphenated and dashed words intact in a single goal', () => {
    expect(splitGoals('Finish A-B testing for sign-up')).toEqual(['Finish A-B testing for sign-up']);
  });

  it('splits on newlines when present', () => {
    expect(splitGoals('Goal one\nGoal two\nGoal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('handles CRLF and blank lines', () => {
    expect(splitGoals('Goal one\r\n\r\nGoal two\r\n')).toEqual(['Goal one', 'Goal two']);
  });

  it('strips bullet decoration from pasted multi-line lists', () => {
    expect(splitGoals('• Goal one\n• Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('- Goal one\n- Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('1. Goal one\n2. Goal two')).toEqual(['Goal one', 'Goal two']);
  });

  it('splits single-line semicolon lists', () => {
    expect(splitGoals('Goal one; Goal two; Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('ignores a trailing semicolon', () => {
    expect(splitGoals('Goal one; Goal two;')).toEqual(['Goal one', 'Goal two']);
  });

  it('splits single-line bullet lists', () => {
    expect(splitGoals('• Goal one • Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('Goal one • Goal two • Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('splits single-line numbered lists', () => {
    expect(splitGoals('1. Goal one 2. Goal two 3. Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
    expect(splitGoals('1) Goal one 2) Goal two')).toEqual(['Goal one', 'Goal two']);
  });

  it('prefers numbering over inner dashes and semicolons', () => {
    expect(splitGoals('1. Ship X - the new one; 2. Fix Y')).toEqual([
      'Ship X - the new one;',
      'Fix Y',
    ]);
  });

  it('splits whitespace-delimited dash bullets', () => {
    expect(splitGoals('Goal one - Goal two - Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('does not split a lone leading number that is not a list', () => {
    expect(splitGoals('1. Just the one goal')).toEqual(['Just the one goal']);
  });

  it('trims surrounding whitespace on every row', () => {
    expect(splitGoals('   Goal one   ;   Goal two   ')).toEqual(['Goal one', 'Goal two']);
  });

  it('is defensive about non-string input', () => {
    // @ts-expect-error deliberately wrong type
    expect(splitGoals(null)).toEqual([]);
    // @ts-expect-error deliberately wrong type
    expect(splitGoals(undefined)).toEqual([]);
  });
});
