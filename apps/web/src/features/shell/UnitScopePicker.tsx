/**
 * NOTE: Planning unit selection: all, one, or any combination.
 *
 * An "either all or one" dropdown answered the wrong question. A unit is a
 * filter, not a boundary (ADR-0032), and a planner who runs AMER alongside
 * Service Transition wants exactly those two: "all" mixes in EMEA and APAC,
 * "one" hides the second unit.
 *
 * A popover with checkboxes rather than `<select multiple>`: the browser's
 * multi-select needs a ctrl-click to deselect one item, and it's easy to lose
 * the whole selection with a stray click.
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
    // NOTE: From "all", the first checkbox click means "only this one":
    // otherwise it would deselect one of four, which is almost never what's wanted.
    const current = all ? allIds : selected.map((u) => u.id);
    const next = all
      ? [unitId]
      : current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId];
    // NOTE: Deselecting the last one means "all," not an empty screen.
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
