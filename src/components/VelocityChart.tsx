import * as React from 'react';

import type { VelocityPoint } from '@/lib/velocity-adapter';
import { cn } from '@/lib/utils';

/**
 * Jira's velocity chart, hand-rolled in SVG.
 *
 * No chart library — this is two rectangles per sprint and a pair of axes, and
 * a dependency for that would outweigh the whole rest of the client bundle.
 *
 * ## Why it looks like Jira and not like the rest of this page
 *
 * Everything else here is ink on paper with one oxblood accent. This chart is
 * grey and green, which is louder than anything else on the page — deliberately.
 * Pete reads Jira's own velocity report every sprint, where **grey is
 * Commitment and green is Completed**. Recolouring those two bars into the
 * page's palette would make the one screen he already knows how to read
 * unfamiliar. Recognition beats palette consistency here, so the two series
 * keep Jira's assignment and everything *around* them — axes, ticks, labels,
 * the table — stays in the form's own greys.
 *
 * ## What the craft guidance changed anyway
 *
 * - **Grey fails a chroma floor** (it is chroma 0 — it "reads as gray", because
 *   it is). That check exists so two *identity* colours are never separated by
 *   lightness alone. Here the pair is fine on every separation check that
 *   matters — ΔE 12.8 under protanopia, 19.1 for normal vision, both well over
 *   the ΔE 8 target — and the grey is not an arbitrary slot, it is Jira's
 *   "what you promised" colour. It also carries secondary encoding: a legend, a
 *   fixed left-then-right position within each sprint's band, and a full table
 *   underneath. So the pair ships as-is.
 * - **Legend always, for two series.** Present, above the plot.
 * - **No number on every bar.** Values live on the y-axis, in the tooltip, and
 *   in the table. Only the selected sprint is directly labelled.
 * - **Solid hairline gridlines**, one step off the surface, never dashed.
 * - **A 2px surface gap** between each sprint's two bars, and bars capped so
 *   the band keeps air rather than being filled edge to edge.
 * - **Rounded data-ends, square at the baseline** — the same 4px the rest of
 *   the page uses for controls, so the bars belong to this UI even though their
 *   colour comes from Jira's.
 * - **A table twin**, rendered by the dialog below the chart, so no value is
 *   reachable only by hovering.
 */

/** Jira's own two: grey commitment, green completed. */
const COMMITMENT = '#8f8f8f';
const COMPLETED = '#14892c';

/**
 * The viewBox is fixed and the SVG scales to its container, so one geometry
 * serves desktop and phone. Units are viewBox units, not pixels.
 */
const VIEW_W = 720;
const VIEW_H = 300;
const PAD = { top: 8, right: 8, bottom: 46, left: 42 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

/** Cap the bar so a band with few sprints keeps air instead of filling. */
const MAX_BAR = 24;
/** The surface gap that separates the two bars in a pair. */
const BAR_GAP = 2;
/** Rounded data-end, square at the baseline. */
const CAP = 4;

/**
 * "Nice" axis ceiling and tick step for a max value.
 *
 * Ticks have to be numbers a person reads without decoding — 0/10/20/30, not
 * 0/13.66/27.33 — so the step is snapped to the 1/2/5/10 ladder and the ceiling
 * is the first multiple of it at or above the tallest bar.
 *
 * The rough step targets `max / 5` rather than `max / 4`. Snapping always
 * rounds the step *up* to the next rung, which rounds the band count *down*, so
 * aiming at four bands lands on three: Skillion Labs peaks at 46, where a
 * quarter is 11.5, which snaps to 20 and draws 0/20/40/60 — a chart with three
 * gridlines and 30% dead space above the tallest bar. A fifth aims at 9.2,
 * snaps to 10, and gives 0/10/20/30/40/50, which is the axis Jira draws.
 */
export function niceScale(max: number): { top: number; step: number } {
  if (!Number.isFinite(max) || max <= 0) return { top: 5, step: 1 };

  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const snapped =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  // Never below 1: story points are whole, and a board whose best sprint was
  // one point would otherwise get an axis labelled 0 / 0.2 / 0.4 / 0.6.
  const step = Math.max(1, snapped);

  // Floor the ceiling at 5 points, not at five *steps*. The concern is only the
  // degenerate small case: a board topping out at 1 point would otherwise scale
  // to a ceiling of 1 — one gridline, the tallest bar filling the plot, and no
  // sense that one point is small. Rex spent three sprints at 0 and one at 1;
  // that stretch should read as flat. Flooring at five *steps* instead would
  // pad every chart — Rex's real max of 20 would ceiling at 25 and leave a
  // fifth of the plot empty above the tallest bar.
  const top = Math.max(Math.ceil(max / step) * step, 5);

  return { top, step };
}

/**
 * A bar with a rounded top and square feet.
 *
 * Drawn as a path rather than a `<rect rx>` because `rx` rounds all four
 * corners, and a bar with rounded feet floats off its own baseline. Below
 * twice the cap height the radius shrinks with the bar, so a 3-point sprint
 * does not render as a lozenge.
 */
function barPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return '';
  const r = Math.min(CAP, width / 2, height / 2);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join('');
}

/**
 * A sprint name shortened to what fits under a bar.
 *
 * "SKIL Sprint 30" under a 24px band is unreadable at any font size that also
 * fits twelve of them. The trailing number is the part that identifies the
 * sprint — every board here names them "<PREFIX> Sprint <n>" — so the axis
 * shows the number and the full name stays in the tooltip and the table.
 */
export function axisLabel(name: string): string {
  const match = /(\d+)\s*$/.exec(String(name ?? '').trim());
  return match?.[1] ?? String(name ?? '').trim().slice(0, 4);
}

export interface VelocityChartProps {
  series: VelocityPoint[];
  /** The sprint the form is on; its pair is highlighted and labelled. */
  selectedSprintId?: number | null;
}

export function VelocityChart({ series, selectedSprintId = null }: VelocityChartProps) {
  /**
   * Which bar the pointer or keyboard is on. `null` is "nothing hovered", and
   * the tooltip is a supplement — every value it shows is also in the table.
   */
  const [active, setActive] = React.useState<number | null>(null);

  const max = Math.max(...series.map((point) => Math.max(point.committed, point.completed)), 0);
  const { top, step } = niceScale(max);

  const band = PLOT_W / Math.max(series.length, 1);
  // Two bars plus their gap, capped, and never wider than 70% of the band so
  // neighbouring sprints stay visibly separate groups.
  const pairWidth = Math.min(MAX_BAR * 2 + BAR_GAP, band * 0.7);
  const barWidth = (pairWidth - BAR_GAP) / 2;

  const y = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;

  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);

  const hovered = active === null ? null : series[active];

  return (
    <div className="relative">
      {/*
        Legend above the plot. Always present for two series — identity must
        never rest on colour matching alone. The swatches carry the colour; the
        text stays in the form's own ink, per the "text never wears the data
        colour" rule.
      */}
      <ul className="m-0 mb-2 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[0.75rem] text-muted">
        {[
          ['Commitment', COMMITMENT],
          ['Completed', COMPLETED],
        ].map(([label, colour]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: colour }}
            />
            {label}
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        // Scales to the dialog's width; the fixed viewBox means the geometry
        // shrinks proportionally rather than reflowing, so it stays legible on
        // a phone instead of squeezing twelve bars into a strip.
        className="block h-auto w-full touch-pan-y"
        role="img"
        aria-label={`Velocity: commitment and completed story points for the last ${series.length} sprint${series.length === 1 ? '' : 's'}. The table below lists every value.`}
        onPointerLeave={() => setActive(null)}
      >
        {/* Y gridlines: solid hairlines one step off the surface, never dashed. */}
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-rule)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y(value)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted text-[11px] [font-variant-numeric:tabular-nums]"
            >
              {value}
            </text>
          </g>
        ))}

        {/* The baseline is darker than the grid: it is where the bars stand. */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-field)"
          strokeWidth={1}
        />

        {/* Y-axis unit, rotated up the side. */}
        <text
          transform={`translate(11 ${PAD.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted text-[11px]"
        >
          Story points
        </text>

        {series.map((point, index) => {
          const centre = PAD.left + band * index + band / 2;
          const left = centre - pairWidth / 2;
          const selected = point.sprintId === selectedSprintId;
          const isActive = active === index;

          return (
            <g key={point.sprintId}>
              {/*
                The hit target is the whole band, not the bars: an 8-point bar
                is a few pixels wide and hovering it exactly is a game. Keyboard
                focus shows the same tooltip as the pointer.
              */}
              <rect
                x={PAD.left + band * index}
                y={PAD.top}
                width={band}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${point.name}: commitment ${point.committed}, completed ${point.completed}`}
                className="cursor-default outline-none focus-visible:fill-ink/5"
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />

              {/*
                The selected sprint gets a pale band behind its pair rather than
                a different bar colour: recolouring would break the grey/green
                contract the reader came in with.
              */}
              {selected && (
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={PLOT_H}
                  className="fill-ink/[0.06]"
                  pointerEvents="none"
                />
              )}

              <path
                d={barPath(left, y(point.committed), barWidth, y(0) - y(point.committed))}
                fill={COMMITMENT}
                opacity={active === null || isActive ? 1 : 0.55}
                pointerEvents="none"
              />
              <path
                d={barPath(
                  left + barWidth + BAR_GAP,
                  y(point.completed),
                  barWidth,
                  y(0) - y(point.completed),
                )}
                fill={COMPLETED}
                opacity={active === null || isActive ? 1 : 0.55}
                pointerEvents="none"
              />

              {/*
                Selective direct labels: only the sprint the form is on. A value
                over every bar is 24 numbers and goes unread.
              */}
              {selected && (
                <text
                  x={centre}
                  y={Math.min(y(point.committed), y(point.completed)) - 6}
                  textAnchor="middle"
                  className="fill-ink text-[11px] font-semibold [font-variant-numeric:tabular-nums]"
                  pointerEvents="none"
                >
                  {point.committed} / {point.completed}
                </text>
              )}

              <text
                x={centre}
                y={y(0) + 16}
                textAnchor="middle"
                className={cn(
                  'text-[11px] [font-variant-numeric:tabular-nums]',
                  selected ? 'fill-ink font-semibold' : 'fill-muted',
                )}
                pointerEvents="none"
              >
                {axisLabel(point.name)}
              </text>
            </g>
          );
        })}

        {/* X-axis unit, under the tick labels. */}
        <text
          x={PAD.left + PLOT_W / 2}
          y={VIEW_H - 6}
          textAnchor="middle"
          className="fill-muted text-[11px]"
        >
          Sprint
        </text>
      </svg>

      {/*
        The tooltip is a plain block under the plot rather than a floating card
        that follows the pointer. It cannot be clipped by the dialog's edge, it
        needs no positioning maths, and — because it holds its height whether or
        not anything is hovered — moving across the chart does not resize the
        dialog under the pointer. It enhances; the table below carries every
        value regardless.
      */}
      <p
        className="m-0 mt-1 min-h-[1.25rem] text-[0.75rem] text-muted"
        role="status"
        aria-live="polite"
      >
        {hovered
          ? `${hovered.name} — commitment ${hovered.committed}, completed ${hovered.completed}`
          : ''}
      </p>
    </div>
  );
}
