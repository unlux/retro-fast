import * as React from 'react';

import { VelocityChart } from '@/components/VelocityChart';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { VelocityPoint } from '@/lib/velocity-adapter';

/**
 * Jira's velocity report, in the retro form.
 *
 * This exists because of the order Pete actually works in: he ends the sprint,
 * *then* looks at the report, then writes the retro. Before this, the middle
 * step meant leaving the page for Jira and coming back. Now ending a sprint
 * opens the report on the spot, and it is one quiet button away for any closed
 * sprint after that.
 *
 * It replicates the Jira view rather than reinventing it — paired grey/green
 * bars over the last ~12 sprints, the same table underneath — so it is
 * recognised rather than read.
 */

type ReportState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; series: VelocityPoint[] }
  | { kind: 'unavailable'; message: string };

export interface VelocityReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  /** Highlighted in the chart and the table. */
  selectedSprintId: number | null;
}

export function VelocityReportDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  selectedSprintId,
}: VelocityReportDialogProps) {
  const [state, setState] = React.useState<ReportState>({ kind: 'idle' });

  /**
   * Fetch on open, and refetch whenever the team changes while open.
   *
   * Not cached across opens: the numbers change the moment a sprint closes,
   * which is precisely when this dialog is most likely to be opened again.
   * `cancelled` guards a team switch landing mid-flight.
   */
  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState({ kind: 'loading' });

    void (async () => {
      try {
        const response = await fetch(
          `/api/velocity-report?team=${encodeURIComponent(teamId)}`,
        );
        if (cancelled) return;

        if (response.status === 401) {
          setState({
            kind: 'unavailable',
            message: 'Jira rejected the credentials — the API token is invalid or expired.',
          });
          return;
        }

        const body = (await response.json()) as {
          available?: boolean;
          series?: VelocityPoint[];
        };
        if (cancelled) return;

        if (body.available !== true || !Array.isArray(body.series) || body.series.length === 0) {
          setState({
            kind: 'unavailable',
            message: `No velocity report is available for ${teamName}. Jira only records these numbers when a sprint closes.`,
          });
          return;
        }

        setState({ kind: 'ready', series: body.series });
      } catch {
        if (!cancelled) {
          setState({ kind: 'unavailable', message: 'Could not reach the server for the report.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, teamId, teamName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <DialogTitle>Velocity — {teamName}</DialogTitle>
            <DialogDescription className="mt-1">
              Commitment against completed story points, oldest sprint first. Straight from
              Jira’s velocity report.
            </DialogDescription>
          </div>
          {/*
            Rendered inside the popup on purpose: with a modal dialog this is
            the only exit a touch screen reader can reach.
          */}
          <DialogClose
            render={
              <Button variant="quiet" size="sm">
                Close
              </Button>
            }
          />
        </header>

        {state.kind === 'loading' && (
          <div aria-busy="true" data-testid="skeleton-report">
            {/* Sized to the chart it stands in for, so nothing jumps on arrival. */}
            <Skeleton className="mb-2 h-4 w-40" />
            <Skeleton className="aspect-[720/300] w-full" />
            <Skeleton className="mt-6 h-40 w-full" />
          </div>
        )}

        {state.kind === 'unavailable' && (
          <p className="m-0 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-3.5 py-3 text-[0.8125rem] text-warn">
            {state.message}
          </p>
        )}

        {state.kind === 'ready' && (
          <>
            <VelocityChart series={state.series} selectedSprintId={selectedSprintId} />

            {/*
              The table is not a fallback, it is the chart's twin: every value
              is here in text, so nothing is reachable only by hovering a bar.
              It also matches the table Jira prints under its own report, which
              is half of why the whole view is recognisable.
            */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full border-collapse text-[0.8125rem]">
                <caption className="mb-2 text-left text-[0.75rem] tracking-[0.12em] text-muted uppercase">
                  Sprint totals
                </caption>
                <thead>
                  <tr className="border-b border-field bg-canvas">
                    <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                      Sprint
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                      Commitment
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      Completed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.series.map((point) => {
                    const selected = point.sprintId === selectedSprintId;
                    return (
                      <tr
                        key={point.sprintId}
                        // Same highlight the chart gives the pair: a pale ink
                        // wash, plus weight, so the row is findable without
                        // colour. `aria-current` says which one in words.
                        {...(selected ? { 'aria-current': 'true' as const } : {})}
                        className={cn(
                          'border-b border-rule last:border-b-0',
                          selected && 'bg-brand-soft font-semibold text-brand',
                        )}
                      >
                        {/*
                          A row header, so a screen reader announces the sprint
                          name with each number. `font-normal` because `<th>`
                          defaults to bold and a whole column of bold sprint
                          names would out-shout the numbers they label — the
                          selected row's own `font-semibold` is what should
                          stand out, and it cannot if everything already is.
                        */}
                        <th
                          scope="row"
                          className={cn('py-1.5 pr-3 text-left', !selected && 'font-normal')}
                        >
                          {point.name}
                          {selected && <span className="sr-only"> (selected sprint)</span>}
                        </th>
                        <td className="py-1.5 pr-3 text-right [font-variant-numeric:tabular-nums]">
                          {point.committed}
                        </td>
                        <td className="py-1.5 text-right [font-variant-numeric:tabular-nums]">
                          {point.completed}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
