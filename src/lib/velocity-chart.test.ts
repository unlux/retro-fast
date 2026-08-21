import { describe, expect, it } from 'vitest';
import { axisLabel, niceScale } from '@/components/VelocityChart';

/**
 * The two pure functions behind the chart's geometry.
 *
 * They live in the component file (they are nothing but chart maths and have no
 * other caller) but they are the only part of it with decisions in it, so they
 * are tested here rather than through a rendered SVG.
 */

describe('niceScale', () => {
  it('rounds up to a readable ceiling with a readable step', () => {
    // Real board maxima: Rex tops out at 20, SL at 46, Marketing at 82.
    expect(niceScale(20)).toEqual({ top: 20, step: 5 });
    // The ceiling hugs the data: 20 does not pad up to 25.
    expect(niceScale(46)).toEqual({ top: 50, step: 10 });
    expect(niceScale(82)).toEqual({ top: 100, step: 20 });
  });

  it('always produces a ceiling at or above the data', () => {
    for (const max of [1, 3, 7, 13, 21, 47, 83, 199, 1001]) {
      const { top, step } = niceScale(max);
      expect(top).toBeGreaterThanOrEqual(max);
      // Ticks must divide the axis evenly, or the top gridline is orphaned.
      expect(top % step).toBe(0);
      // Three to five bands: fewer is a bare axis, more is a hatched one.
      expect(top / step).toBeGreaterThanOrEqual(3);
      expect(top / step).toBeLessThanOrEqual(5);
    }
  });

  it('gives an all-zero board a real axis instead of dividing by zero', () => {
    // Rex sprints 20–22 are genuinely 0/0; a board of only those must still
    // draw ticks rather than collapse to a single line at infinity.
    expect(niceScale(0)).toEqual({ top: 5, step: 1 });
    expect(niceScale(Number.NaN)).toEqual({ top: 5, step: 1 });
    expect(niceScale(-3)).toEqual({ top: 5, step: 1 });
  });

  it('never steps below a whole point', () => {
    // Story points are integers. A board whose best sprint was 1 point must
    // not get an axis labelled 0 / 0.2 / 0.4.
    for (const max of [1, 2, 3, 4]) {
      const { step } = niceScale(max);
      expect(step).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(step)).toBe(true);
    }
  });

  it('keeps steps on the 1/2/5/10 ladder', () => {
    for (const max of [4, 9, 12, 28, 55, 140, 640]) {
      const { step } = niceScale(max);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });
});

describe('axisLabel', () => {
  it('reduces a sprint name to its number', () => {
    // Twelve full names under a 720-unit axis is unreadable; the number is what
    // identifies the sprint, and the full name stays in the tooltip and table.
    expect(axisLabel('REX Sprint 31')).toBe('31');
    expect(axisLabel('SKIL Sprint 30')).toBe('30');
    expect(axisLabel('SL Sprint 1')).toBe('1');
    expect(axisLabel('Sprint 7 ')).toBe('7');
  });

  it('falls back to a short prefix when there is no trailing number', () => {
    expect(axisLabel('Final push')).toBe('Fina');
    expect(axisLabel('Hardening')).toBe('Hard');
  });

  it('takes the trailing number even when the name is only a number', () => {
    // "Q3" is a trailing number, so it labels as "3" — correct, and the same
    // rule `sprintNumber` already applies to the form's own sprint field.
    expect(axisLabel('Q3')).toBe('3');
    expect(axisLabel('12')).toBe('12');
  });

  it('survives a missing or empty name', () => {
    expect(axisLabel('')).toBe('');
    expect(axisLabel(undefined as unknown as string)).toBe('');
  });
});
