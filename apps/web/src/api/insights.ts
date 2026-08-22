/**
 * Пояснения поверх плана — то, что модель формулирует, а не решает.
 *
 * Счётчики в ответе приходят от валидатора, текст — от модели, и в интерфейсе
 * они показываются рядом: читатель может сверить одно с другим. Это не
 * украшение, а условие, на котором такой панели вообще есть место в
 * инструменте планирования.
 *
 * Фича необязательная: без ключа на сервере эндпоинт отвечает 503
 * `AI_NOT_CONFIGURED`, и панель просто не показывается. Ничто в планировании от
 * неё не зависит.
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
  /** null, когда модель не вызывалась — в периоде нечего объяснять. */
  readonly model: string | null;
  readonly generatedAt: string;
}

/** Почему саммари нет: «не настроено» и «сломалось» — разные сообщения. */
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
