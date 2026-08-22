/**
 * NOTE: Explanations layered on top of the plan — what the model phrases, not
 * what it decides.
 *
 * The counters in the response come from the validator, the text from the
 * model, and the UI shows them side by side: the reader can check one against
 * the other. That's not decoration, it's the condition under which a panel
 * like this gets to exist in a planning tool at all.
 *
 * NOTE: The feature is optional: without a key configured on the server, the
 * endpoint answers 503 `AI_NOT_CONFIGURED` and the panel simply doesn't show.
 * Nothing in planning depends on it.
 */

import { apiPost, ApiError } from './client.ts';
import type { DateRange, IsoDate, UnitId } from '../domain/types.ts';

export interface GapSummary {
  readonly summary: string;
  readonly total: number;
  readonly gaps: number;
  readonly conflicts: number;
  readonly warnings: number;
  readonly blocking: number;
  /** NOTE: null when the model wasn't called — nothing to explain in the period. */
  readonly model: string | null;
  readonly generatedAt: string;
}

/** NOTE: Why the summary is missing: "not configured" and "broke" are different messages. */
export type GapSummaryFailure = 'NOT_CONFIGURED' | 'UNAVAILABLE';

export class GapSummaryError extends Error {
  constructor(
    readonly kind: GapSummaryFailure,
    message: string,
  ) {
    super(message);
    this.name = 'GapSummaryError';
  }
}

export async function fetchGapSummary(params: {
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly draftId?: string | undefined;
}): Promise<GapSummary> {
  try {
    return await apiPost<GapSummary>('/api/insights/gap-summary', {
      unitId: params.unitId,
      from: params.range.from as IsoDate,
      to: params.range.to as IsoDate,
      draftId: params.draftId ?? null,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      throw new GapSummaryError('NOT_CONFIGURED', 'Summaries are not configured on the server.');
    }
    if (error instanceof ApiError && error.status === 502) {
      throw new GapSummaryError('UNAVAILABLE', 'The summary service is unavailable right now.');
    }
    throw error;
  }
}
