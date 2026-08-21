import { describe, expect, it } from 'vitest';
import type { BauItem } from './bau';
import { newGoal, type Goal } from './format';
import {
  buildPlanText,
  mergeGoalText,
  planLines,
  seedPlanFromGoals,
} from './plan';

const bau = (...texts: string[]): BauItem[] =>
  texts.map((text, index) => ({ id: `b${index}`, text }));

describe('planLines', () => {
  it('keeps non-empty trimmed lines in order', () => {
    expect(planLines('  a  \n\n b \n\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('handles every newline flavour', () => {
    expect(planLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([[''], ['   \n  \n'], [null], [undefined]])('returns [] for %p', (value) => {
    expect(planLines(value as unknown as string)).toEqual([]);
  });
});

describe('buildPlanText', () => {
  it('puts the goals, a blank line, then the BAU block', () => {
    const text = buildPlanText('Ship the thing\nFix the other', bau('RFP', 'Marketing Video'));

    expect(text).toBe(
      'Ship the thing\nFix the other\n\nBAU\n- [ ] RFP\n- [ ] Marketing Video',
    );
  });

  it('appends every BAU item unchecked, whatever last sprint did', () => {
    // No checks argument exists at all: a sprint that has not started has done
    // none of its standing work, and a carried-over [x] would be a false claim.
    const text = buildPlanText('Goal', bau('A', 'B'));

    expect(text).toContain('- [ ] A');
    expect(text).toContain('- [ ] B');
    expect(text).not.toContain('[x]');
  });

  it('omits the BAU block entirely when the list is empty', () => {
    expect(buildPlanText('Goal one\nGoal two', [])).toBe('Goal one\nGoal two');
    expect(buildPlanText('Goal one')).toBe('Goal one');
  });

  it('emits the BAU block alone when there are no goal lines', () => {
    expect(buildPlanText('   ', bau('RFP'))).toBe('BAU\n- [ ] RFP');
  });

  it('is empty when there is nothing to push', () => {
    expect(buildPlanText('', [])).toBe('');
    expect(buildPlanText('  \n \n ', [])).toBe('');
  });

  it('normalizes goal-line spacing so the preview is the pushed text', () => {
    expect(buildPlanText('  Ship it  \n\n  Fix it ', [])).toBe('Ship it\nFix it');
  });

  it('round-trips: what it builds is what a BAU parse reads back', async () => {
    const { splitBauBlock } = await import('./bau');
    const text = buildPlanText('Ship it', bau('RFP', 'linkedin post.'));
    const { rest, bau: parsed } = splitBauBlock(text);

    expect(rest.trim()).toBe('Ship it');
    expect(parsed!.items).toEqual(['RFP', 'linkedin post.']);
    expect(parsed!.checked).toEqual([]);
  });
});

describe('seedPlanFromGoals', () => {
  const goals: Goal[] = [
    { text: 'Investor FUP', status: 'done' },
    { text: 'K/O money flow', status: 'wip' },
    { text: 'July Metrics', status: 'not-done' },
    { text: '   ', status: 'wip' },
  ];

  it('takes wip and not-done, drops done, and carries no status tokens', () => {
    expect(seedPlanFromGoals(goals)).toBe('K/O money flow\nJuly Metrics');
  });

  it('preserves order and skips blank rows', () => {
    expect(seedPlanFromGoals([newGoal('b'), newGoal('a')])).toBe('b\na');
  });

  it.each([[[]], [null], [undefined]])('returns "" for %p', (value) => {
    expect(seedPlanFromGoals(value as unknown as Goal[])).toBe('');
  });

  it('feeds straight back into buildPlanText', () => {
    const text = buildPlanText(seedPlanFromGoals(goals), bau('RFP'));

    expect(text).toBe('K/O money flow\nJuly Metrics\n\nBAU\n- [ ] RFP');
  });
});

describe('mergeGoalText', () => {
  it('appends after a blank line, keeping what is there', () => {
    expect(mergeGoalText('Old goal', 'New goal', 'append')).toBe('Old goal\n\nNew goal');
  });

  it('replaces with the new text alone', () => {
    expect(mergeGoalText('Old goal', 'New goal', 'replace')).toBe('New goal');
  });

  it('appends to nothing without leaving leading blank lines', () => {
    expect(mergeGoalText('', 'New goal', 'append')).toBe('New goal');
    expect(mergeGoalText('   \n ', 'New goal', 'append')).toBe('New goal');
  });

  it('keeps the existing text when there is nothing new to add', () => {
    expect(mergeGoalText('Old goal', '   ', 'append')).toBe('Old goal');
  });

  it('trims the ends but never the middle', () => {
    expect(mergeGoalText('  A\nB  ', '  C\nD  ', 'append')).toBe('A\nB\n\nC\nD');
  });

  it.each([[null], [undefined]])('tolerates %p on either side', (value) => {
    expect(mergeGoalText(value as unknown as string, 'New', 'append')).toBe('New');
    expect(mergeGoalText('Old', value as unknown as string, 'append')).toBe('Old');
  });
});
