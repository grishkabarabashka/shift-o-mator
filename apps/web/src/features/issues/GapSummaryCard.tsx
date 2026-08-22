/**
 * NOTE: Plain-English summary of this period's issues, layered over the same
 * issues panel.
 * NOTE: On-demand via a button, not automatic: the request costs money and
 * time, and a planner opens this screen dozens of times a day. The generated
 * text is kept until the period or unit changes, then reset because it
 * described a different plan.
 * NOTE: The counters from the validator always sit next to the text. The
 * model writes the text, the engine computes the numbers; showing both
 * together lets one be checked against the other without leaving the screen.
 * Without that, the panel would have to be taken on faith.
 * NOTE: If no key is configured on the server, the card doesn't show at all.
 */

import { useEffect, useState } from 'react';
import { fetchGapSummary, GapSummaryError, type GapSummary } from '../../api/insights.ts';
import type { DateRange, UnitId } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';

interface Props {
  readonly unitId: UnitId | undefined;
  readonly range: DateRange | undefined;
  readonly issueCount: number;
}

export function GapSummaryCard({ unitId, range, issueCount }: Props) {
  const [summary, setSummary] = useState<GapSummary>();
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  // NOTE: The summary belongs to a specific (unit, period): when either
  // changes, the old text no longer describes what's on screen.
  useEffect(() => {
    setSummary(undefined);
    setError(undefined);
  }, [unitId, range?.from, range?.to]);

  if (unavailable || !unitId || !range) return null;

  const run = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      setSummary(
        await fetchGapSummary({ unitId, range, draftId: useSchedule.getState().session?.id }),
      );
    } catch (caught) {
      if (caught instanceof GapSummaryError && caught.kind === 'NOT_CONFIGURED') {
        // NOTE: A deployment without model access isn't a screen error: the
        // card just disappears and stops asking.
        setUnavailable(true);
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border-b border-line px-3 py-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[12.5px] font-semibold">Summary</h3>
        <button
          type="button"
          className="btn btn--sm ml-auto"
          disabled={loading}
          onClick={() => void run()}
          title="Explain this period's gaps, conflicts and warnings in plain English"
        >
          {loading ? 'Reading…' : summary ? 'Refresh' : 'Explain'}
        </button>
      </div>

      {error ? <p className="mt-2 text-[11.5px] text-bad">{error}</p> : null}

      {summary ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-[1.45]">{summary.summary}</p>
          {/* NOTE: Numbers next to the text — computed by the validator, not the model. */}
          <p className="mt-2 text-[11px] text-faint">
            From {summary.gaps} gaps, {summary.conflicts} conflicts, {summary.warnings} warnings
            {summary.blocking > 0 ? `, ${summary.blocking} blocking` : ''}
            {summary.model ? ` · ${summary.model}` : ''}
          </p>
        </>
      ) : !error && !loading ? (
        <p className="mt-1.5 text-[11px] text-faint">
          {issueCount === 0
            ? 'Nothing to explain — this period is clean.'
            : `${issueCount} findings in this period.`}
        </p>
      ) : null}
    </section>
  );
}
