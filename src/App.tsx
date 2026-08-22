/**
 * Экран планирования: сетка, полоса покрытия, панель нарушений.
 *
 * Остальные экраны (timeline, absence overview, аналитика) — следующие этапы
 * плана работ, см. Docs/09-roadmap.md.
 */

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PERIOD } from './domain/fixtures.ts';
import { addDays, monthRange, toIsoDate, parseDate } from './engine/dates.ts';
import { useSchedule } from './store/useSchedule.ts';
import { TooltipProvider } from './ui/primitives.tsx';
import { AbsenceDialog } from './features/absences/AbsenceDialog.tsx';
import { SelectionToolbar } from './features/absences/SelectionToolbar.tsx';
import { CompDayDialog } from './features/compdays/CompDayDialog.tsx';
import { CoverageStrip } from './features/coverage/CoverageStrip.tsx';
import { IssuePanel } from './features/issues/IssuePanel.tsx';
import { PlanningGrid } from './features/planning/PlanningGrid.tsx';
import { RolePalette } from './features/planning/RolePalette.tsx';
import { usePlanningView } from './features/planning/usePlanningView.ts';
import { Header } from './features/shell/Header.tsx';

const DEFAULT_UNIT = 'unit-amer';

/**
 * Сегодняшняя дата берётся один раз за сессию: движок принимает её параметром,
 * и подсовывать в него `new Date()` из глубины компонентов нельзя.
 */
function todayIso(): string {
  return toIsoDate(parseDate(new Date().toISOString().slice(0, 10)));
}

export function App() {
  const [unitId, setUnitId] = useState(DEFAULT_UNIT);
  const [anchor, setAnchor] = useState<string>(DEFAULT_PERIOD.from);
  const asOf = useMemo(todayIso, []);

  const load = useSchedule((s) => s.load);
  const status = useSchedule((s) => s.status);
  const error = useSchedule((s) => s.error);
  const reference = useSchedule((s) => s.reference);

  const range = useMemo(() => monthRange(anchor), [anchor]);
  const view = usePlanningView(asOf);

  useEffect(() => {
    void load(unitId, range);
  }, [load, unitId, range]);

  const shiftMonth = (delta: number) => {
    const next = delta > 0 ? addDays(range.to, 1) : addDays(range.from, -1);
    setAnchor(next);
  };

  if (status === 'error') {
    return <div className="app__loading">Не удалось загрузить данные: {error}</div>;
  }

  if (!reference || !view.ready) {
    return <div className="app__loading">Загрузка…</div>;
  }

  return (
    <TooltipProvider>
      <div className="app">
        <Header
          units={reference.units}
          unitId={unitId}
          range={range}
          view={view}
          onUnitChange={setUnitId}
          onShiftMonth={shiftMonth}
        />
        <div className="app__body">
          <div className="app__main">
            <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', minHeight: 0 }}>
              <RolePalette roles={view.roles} referenceDate={range.from} />
              <SelectionToolbar view={view} />
              <PlanningGrid view={view} />
            </div>
            <CoverageStrip view={view} />
          </div>
          <IssuePanel view={view} />
        </div>
        <AbsenceDialog />
        <CompDayDialog />
      </div>
    </TooltipProvider>
  );
}
