/**
 * Выбор единиц планирования: все, одна или произвольный набор.
 *
 * Выпадающий список «либо все, либо одна» отвечал не на тот вопрос. Единица —
 * фильтр, а не граница (ADR-0032), и планировщик, который ведёт AMER вместе с
 * Service Transition, хочет ровно эти две: со «всеми» к ним примешиваются EMEA
 * и APAC, с «одной» вторую не видно.
 *
 * Popover с чекбоксами, а не `<select multiple>`: последний в браузере требует
 * ctrl-клика, чтобы снять один пункт, и на нём легко потерять весь набор
 * случайным кликом.
 */

import * as Popover from '@radix-ui/react-popover';
import type { PlanningUnit, UnitId } from '../../domain/types.ts';
import { formatUnitScope, isAllUnits, scopeIncludes } from '../../domain/unitScope.ts';
import { ALL_UNITS } from '../../domain/types.ts';

interface Props {
  readonly units: readonly PlanningUnit[];
  readonly scope: string;
  readonly onChange: (scope: string) => void;
}

export function UnitScopePicker({ units, scope, onChange }: Props) {
  const allIds = units.map((u) => u.id);
  const selected = units.filter((u) => scopeIncludes(scope, u.id));
  const all = isAllUnits(scope);

  const label = all
    ? 'All planning units'
    : selected.length === 1
      ? (selected[0]?.name ?? scope)
      : `${selected.length} units`;

  const toggle = (unitId: UnitId): void => {
    // От «всех» первый же клик по чекбоксу означает «только эта»: иначе он
    // снимал бы одну из четырёх, что почти никогда не то, чего хотят.
    const current = all ? allIds : selected.map((u) => u.id);
    const next = all
      ? [unitId]
      : current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId];
    // Снять последнюю — это «все», а не пустой экран.
    onChange(next.length === 0 ? ALL_UNITS : formatUnitScope(next, allIds));
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="field flex items-center gap-1.5 whitespace-nowrap"
          aria-label="Planning units"
          title={all ? 'Every planning unit' : selected.map((u) => u.name).join(', ')}
        >
          <span className="text-[12.5px]">{label}</span>
          <span aria-hidden className="text-[8px] text-faint">
            ▼
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="popover w-[230px] p-1"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
            onClick={() => onChange(ALL_UNITS)}
          >
            <span aria-hidden className="w-3.5 text-center text-[11px] text-accent">
              {all ? '✓' : ''}
            </span>
            All planning units
          </button>

          <div className="my-1 h-px bg-line" />

          {units.map((unit) => {
            const on = !all && scopeIncludes(scope, unit.id);
            return (
              <button
                key={unit.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
                onClick={() => toggle(unit.id)}
                aria-pressed={on}
              >
                <span aria-hidden className="w-3.5 text-center text-[11px] text-accent">
                  {on ? '✓' : ''}
                </span>
                <span className="truncate">{unit.name}</span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
