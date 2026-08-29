/**
 * Pending requests, projected onto grid cells.
 *
 * The third projection over the same cell keys, after `cellValue` and `presence`. Same
 * reason as ADR-0043: a pending request is not a competing answer to "what is this
 * person doing" — it is a proposal that coexists with whatever the cell already says.
 * Nothing here is an absence; nothing materializes until approval (ADR-0045).
 */

import type { DayPortion, IsoDate, PersonId } from '../domain/types.ts';
import { cellKey } from '../domain/lookup.ts';

export type PendingCategory = 'PRESENCE' | 'LEAVE' | 'SWAP' | 'COMP_DAY' | 'OTHER';

export interface PendingRequest {
  readonly id: string;
  readonly portion: DayPortion;
  readonly typeCode: string;
  readonly typeLabel: string;
  readonly category: PendingCategory;
  readonly subjectPersonId: PersonId;
  readonly subjectDisplayName: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly createdAt: string;
  /** Whether the signed-in caller may approve or decline it. Computed server-side —
   * route membership is not something the client can work out. */
  readonly callerCanDecide: boolean;
}

/** What a cell should show for a pending request. */
export interface PendingMark {
  readonly requestId: string;
  readonly portion: DayPortion;
  readonly label: string;
  readonly category: PendingCategory;
  /** One or two characters for the cell band. */
  readonly glyph: string;
  readonly callerCanDecide: boolean;
}

export interface RequestProjection {
  readonly byCell: ReadonlyMap<string, PendingMark>;
  readonly byRequestId: ReadonlyMap<string, PendingRequest>;
}

function glyphFor(request: PendingRequest): string {
  if (request.category === 'LEAVE') return 'L?';
  if (request.category === 'PRESENCE') return request.typeCode.startsWith('OFFICE') ? 'O?' : 'R?';
  return '?';
}

export function projectRequests(params: {
  readonly requests: readonly PendingRequest[];
  readonly dates: readonly IsoDate[];
}): RequestProjection {
  const byCell = new Map<string, PendingMark>();
  const byRequestId = new Map<string, PendingRequest>();

  for (const request of params.requests) {
    byRequestId.set(request.id, request);
    const mark: PendingMark = {
      requestId: request.id,
      portion: request.portion,
      label: `${request.typeLabel} — awaiting approval`,
      category: request.category,
      glyph: glyphFor(request),
      callerCanDecide: request.callerCanDecide,
    };

    for (const date of params.dates) {
      if (date < request.from || date > request.to) continue;
      // Last writer wins per cell, but a request this caller can act on outranks one
      // they cannot: the actionable one is the reason to look at the cell at all.
      const existing = byCell.get(cellKey(request.subjectPersonId, date));
      if (existing && existing.callerCanDecide && !mark.callerCanDecide) continue;
      byCell.set(cellKey(request.subjectPersonId, date), mark);
    }
  }

  return { byCell, byRequestId };
}

/** Pending requests covering one cell — what the picker offers to decide. */
export function pendingAt(
  projection: RequestProjection,
  personId: PersonId,
  date: IsoDate,
): PendingRequest | undefined {
  const mark = projection.byCell.get(cellKey(personId, date));
  return mark ? projection.byRequestId.get(mark.requestId) : undefined;
}
