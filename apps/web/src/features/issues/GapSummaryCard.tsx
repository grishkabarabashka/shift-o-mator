/**
 * Саммари по нарушениям за период — текстом, поверх той же панели нарушений.
 *
 * По кнопке, а не само: запрос стоит денег и времени, а планировщик открывает
 * этот экран десятки раз за день. Сгенерированное держится до смены периода или
 * единицы — тогда оно сбрасывается, потому что относилось к другому плану.
 *
 * Рядом с текстом всегда стоят счётчики из валидатора. Текст пишет модель,
 * числа — движок; показывать их вместе значит дать возможность сверить одно с
 * другим, не уходя с экрана. Без этого панель пришлось бы принимать на веру.
 *
 * Если ключ на сервере не настроен, карточка не показывается совсем.
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

  // Саммари относится к конкретному (единица, период): при их смене прежний
  // текст говорит уже не о том, что на экране.
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
        // Развёртывание без доступа к модели — это не ошибка экрана: карточка
        // просто исчезает и больше не спрашивает.
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
          {/* Числа рядом с текстом — их считал валидатор, не модель. */}
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
