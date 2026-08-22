/**
 * Шапка: выбор единицы и периода, таймзона отображения, состояние сохранения
 * и блокировки, сводка по покрытию и нарушениям.
 *
 * Переключатель таймзоны виден всегда — это требование раздела «Время».
 */

import type { DateRange, PlanningUnit } from '../../domain/types.ts';
import { hasUnsavedChanges, useSchedule } from '../../store/useSchedule.ts';
import { useUi, type DisplayZone } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';
import type { PlanningView } from '../planning/usePlanningView.ts';

interface Props {
  readonly units: readonly PlanningUnit[];
  readonly unitId: string;
  readonly range: DateRange;
  readonly view: PlanningView;
  readonly onUnitChange: (unitId: string) => void;
  readonly onShiftMonth: (delta: number) => void;
}

export function Header({ units, unitId, range, view, onUnitChange, onShiftMonth }: Props) {
  const undo = useSchedule((s) => s.undo);
  const redo = useSchedule((s) => s.redo);
  const save = useSchedule((s) => s.save);
  const undoDepth = useSchedule((s) => s.undoStack.length);
  const redoDepth = useSchedule((s) => s.redoStack.length);
  const saving = useSchedule((s) => s.saving);
  const dirty = useSchedule(hasUnsavedChanges);
  const lock = useSchedule((s) => s.lock);
  const lockConflict = useSchedule((s) => s.lockConflict);
  const acquireLock = useSchedule((s) => s.acquireLock);
  const releaseLock = useSchedule((s) => s.releaseLock);

  const displayZone = useUi((s) => s.displayZone);
  const setDisplayZone = useUi((s) => s.setDisplayZone);

  const zoneOptions: SelectOption[] = [
    { value: 'role', label: 'Время роли' },
    { value: 'UTC', label: 'UTC' },
    ...uniqueZones(view).map((zone) => ({ value: zone, label: zone })),
  ];

  const blocking = view.issueSummary.blocking;

  return (
    <header className="header">
      <span className="header__title">shift-o-mator</span>

      <Select
        ariaLabel="Единица планирования"
        value={unitId}
        onChange={onUnitChange}
        options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
      />

      <div className="header__group">
        <button type="button" className="btn btn--ghost" onClick={() => onShiftMonth(-1)}>
          ←
        </button>
        <span className="header__stat">{range.from.slice(0, 7)}</span>
        <button type="button" className="btn btn--ghost" onClick={() => onShiftMonth(1)}>
          →
        </button>
      </div>

      <div className="header__group">
        <span className="header__label">Показывать в</span>
        <Select
          ariaLabel="Таймзона отображения"
          value={displayZone}
          onChange={(value) => setDisplayZone(value as DisplayZone)}
          options={zoneOptions}
        />
      </div>

      <div className="header__group">
        <button type="button" className="btn" onClick={undo} disabled={undoDepth === 0}>
          Отменить <span className="btn__badge">{undoDepth || ''}</span>
        </button>
        <button type="button" className="btn" onClick={redo} disabled={redoDepth === 0}>
          Повторить <span className="btn__badge">{redoDepth || ''}</span>
        </button>
      </div>

      <div className="header__spacer" />

      <div className="header__group">
        <span
          className={`header__stat ${blocking > 0 ? 'header__stat--blocking' : ''}`}
          title="Дыры в покрытии и другие блокирующие нарушения"
        >
          BLK {blocking}
        </span>
        <span
          className={`header__stat ${
            view.issueSummary.unacknowledgedWarnings > 0 ? 'header__stat--warning' : ''
          }`}
          title="Предупреждения без подтверждения"
        >
          WRN {view.issueSummary.unacknowledgedWarnings}
        </span>
        <span className="header__stat" title="Информационные сигналы">
          INF {view.issueSummary.info}
        </span>
      </div>

      <div className="header__group">
        {lock ? (
          <button type="button" className="btn" onClick={releaseLock}>
            Снять блокировку
          </button>
        ) : (
          <button type="button" className="btn" onClick={acquireLock}>
            Взять период
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? 'Сохранение…' : dirty ? 'Сохранить' : 'Сохранено'}
        </button>
      </div>

      {lockConflict ? (
        <span className="header__notice">
          Период редактирует {lockConflict.byPersonId} с {lockConflict.acquiredAt.slice(11, 16)}
        </span>
      ) : null}

      {blocking > 0 ? (
        <span className="header__notice">Публикация невозможна: не закрыт минимум покрытия</span>
      ) : null}
    </header>
  );
}

function uniqueZones(view: PlanningView): string[] {
  const zones = new Set<string>();
  for (const role of view.roles) zones.add(role.timeZone);
  for (const row of view.rows) {
    if (row.kind === 'person') zones.add(row.location.timeZone);
  }
  return [...zones].sort();
}
