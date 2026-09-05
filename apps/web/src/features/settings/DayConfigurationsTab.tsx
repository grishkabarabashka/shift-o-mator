import { useState } from 'react';
import { useCreateDayConfigVersion } from '../../api/admin.ts';
import { weekdaysToWire } from '../../api/mapping.ts';
import { type DayConfiguration, type DayConfigKey, type ShiftRequirement, type Weekday } from '../../domain/types.ts';
import { NativeSelectField, NumberField, TextField } from './fields.tsx';
import { ApiError } from '../../api/client.ts';
import { type Reference, WeekdaysEditor } from './shared.tsx';

function describeKey(config: { key: DayConfigKey; date?: string }): string {
  if (config.date) return `Event on ${config.date}`;
  switch (config.key) {
    case 'WEEKEND':
      return 'Weekend';
    case 'HOLIDAY':
      return 'Holiday';
    case 'WEEKDAY':
      return 'Weekdays';
    case 'FRIDAY':
      return 'Friday';
    default:
      return config.key;
  }
}

export function DayConfigurationsTab({ reference }: { readonly reference: Reference }) {
  // `undefined` = the form is closed; a `DayConfiguration` = open, started from that
  // version. Retyping a five-shift set to change one minimum was the whole cost of a
  // rule change here.
  const [creating, setCreating] = useState<{ readonly seed?: DayConfiguration } | undefined>();
  const [unitFilter, setUnitFilter] = useState<string>('');
  const grouped = new Map<string, DayConfiguration[]>();
  for (const config of reference.dayConfigurations) {
    if (unitFilter && config.unitId !== unitFilter) continue;
    const groupKey = `${config.unitId}|${config.key}|${config.date ?? ''}`;
    const list = grouped.get(groupKey) ?? [];
    list.push(config);
    grouped.set(groupKey, list);
  }
  const unitName = (id: string) => reference.units.find((u) => u.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11.5px] text-faint">
          Every version is kept — editing means creating a new one effective from a future date, never overwriting history.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <NativeSelectField
            value={unitFilter}
            ariaLabel="Filter by unit"
            options={[{ value: '', label: 'Every unit' }, ...reference.units.map((u) => ({ value: u.id, label: u.name }))]}
            onChange={setUnitFilter}
          />
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setCreating({})}>
            + New version
          </button>
        </div>
      </div>

      {creating ? (
        <NewDayConfigVersionForm
          reference={reference}
          {...(creating.seed ? { seed: creating.seed } : {})}
          onDone={() => setCreating(undefined)}
        />
      ) : null}

      {grouped.size === 0 ? (
        <p className="text-[12px] text-faint">
          No day configurations{unitFilter ? ` in ${unitName(unitFilter)}` : ''} yet — every day would fall through to no shift set at all.
        </p>
      ) : null}

      {[...grouped.entries()].map(([groupKey, versions]) => {
        const sorted = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
        const [current, ...history] = sorted;
        if (!current) return null;
        return (
          <div key={groupKey} className="card p-2">
            <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1">
              <span className="pill pill--accent">live</span>
              <span className="text-muted">{unitName(current.unitId)}</span>
              <span className="font-medium">{describeKey(current)}</span>
              <span className="text-[11px] text-faint">effective since {current.effectiveFrom}</span>
              <button
                type="button"
                className="btn btn--sm btn--ghost ml-auto"
                onClick={() => setCreating({ seed: current })}
              >
                New version from this
              </button>
              {history.length > 0 ? (
                <span className="text-[11px] text-faint">{history.length} earlier version{history.length > 1 ? 's' : ''}</span>
              ) : null}
            </div>
            <ShiftRequirementList reference={reference} requirements={current.shiftRequirements} />
            {history.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-faint">
                  Version history — superseded, not editable
                </summary>
                {history.map((v) => (
                  <div key={v.id} className="mt-1 border-t border-[var(--border)] pt-1 opacity-70">
                    <span className="text-[11px] text-faint">was effective from {v.effectiveFrom}</span>
                    <ShiftRequirementList reference={reference} requirements={v.shiftRequirements} />
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ShiftRequirementList({
  reference,
  requirements,
}: {
  readonly reference: Reference;
  readonly requirements: readonly ShiftRequirement[];
}) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {requirements.map((requirement) => {
        const shift = reference.shifts.find((s) => s.id === requirement.shiftId);
        return (
          <span
            key={requirement.shiftId}
            className="pill"
            title={`${shift?.label ?? requirement.shiftId}: min ${requirement.min}${requirement.max !== undefined ? `, max ${requirement.max}` : ''}`}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: shift?.color ?? 'var(--accent)' }} />
            {shift?.code ?? requirement.shiftId}
            <span className="text-faint">
              {requirement.min}
              {requirement.max !== undefined ? `–${requirement.max}` : ''}
            </span>
            {/* The requirement everyone else falls into (ADR-0038) — invisible here until
                now, which made two otherwise identical-looking sets behave differently. */}
            {requirement.isDefault ? (
              <span className="text-[10px] text-faint" title="Absorbs everyone with no other shift">
                default
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** One shift's line in the form below. Absent from the map = not in this day's set. */
interface RequirementDraft {
  readonly min: number;
  readonly max: number | null;
  readonly isDefault: boolean;
}

/**
 * A new version of a day configuration.
 *
 * Three things this form used to make impossible, all of them decisions the domain
 * treats as ordinary:
 *  - a requirement with `min: 0`, silently dropped by a `min > 0` filter although
 *    ADR-0034 calls a zero minimum a legal coverage state;
 *  - `isDefault`, hardcoded to false — so the requirement that absorbs everyone on an
 *    ordinary day (ADR-0038) could not be expressed from the screen at all;
 *  - `max`, which is what makes a `COVERAGE_OVER_MAX` warning possible.
 * Membership of the day's shift set is now the tick, not a nonzero minimum.
 */
function NewDayConfigVersionForm({
  reference,
  seed,
  onDone,
}: {
  readonly reference: Reference;
  readonly seed?: DayConfiguration;
  readonly onDone: () => void;
}) {
  const create = useCreateDayConfigVersion();
  const [unitId, setUnitId] = useState(seed?.unitId ?? reference.units[0]?.id ?? '');
  const [key, setKey] = useState<DayConfigKey>(seed?.key ?? 'WEEKDAY');
  const [weekdays, setWeekdays] = useState<readonly Weekday[]>(seed?.weekdays ?? [1, 2, 3, 4]);
  const [date, setDate] = useState(seed?.date ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [label, setLabel] = useState(seed?.label ?? '');
  const [requirements, setRequirements] = useState<Map<string, RequirementDraft>>(
    new Map(
      (seed?.shiftRequirements ?? []).map((r) => [
        r.shiftId,
        { min: r.min, max: r.max ?? null, isDefault: r.isDefault },
      ]),
    ),
  );
  const [error, setError] = useState<string | undefined>();

  const unitShifts = reference.shifts.filter((s) => s.unitId === unitId);
  // A holiday configuration applies to any weekday the calendar calls a holiday, so the
  // resolver never reads its `weekdays` — but the server still asks for a non-empty set.
  const weekdaysApply = key !== 'HOLIDAY' && key !== 'DATE';
  const patch = (shiftId: string, next: Partial<RequirementDraft>) => {
    setRequirements((prev) => {
      const map = new Map(prev);
      const current = map.get(shiftId) ?? { min: 0, max: null, isDefault: false };
      map.set(shiftId, { ...current, ...next });
      return map;
    });
  };

  async function submit() {
    setError(undefined);
    try {
      await create.mutateAsync({
        unitId,
        key,
        weekdays: weekdaysToWire(weekdaysApply ? [...weekdays] : ([1, 2, 3, 4, 5, 6, 7] as Weekday[])),
        date: key === 'DATE' ? date : null,
        label: label || null,
        effectiveFrom,
        shiftRequirements: [...requirements.entries()].map(([shiftId, r]) => ({
          shiftId,
          min: r.min,
          max: r.max,
          isDefault: r.isDefault,
          timingOverrideStart: null,
          timingOverrideEnd: null,
          timingOverrideCrossesMidnight: null,
        })),
      });
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Could not create this version — check the effective date and the shift set.',
      );
    }
  }

  return (
    <div className="card flex flex-col gap-2 border-2 border-accent p-3">
      <p
        className="text-[12px] text-ink"
        title="Coverage before the effective date keeps using whatever version applied then."
      >
        Creates a <strong>new version</strong> effective from the date below — the live
        configuration is never edited in place.
        {seed ? ' Started from the version currently live, so only the change has to be typed.' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelectField
          value={unitId}
          ariaLabel="Unit"
          options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
          onChange={setUnitId}
        />
        <NativeSelectField
          value={key}
          ariaLabel="Applies to"
          options={[
            { value: 'WEEKDAY', label: 'Weekdays' },
            { value: 'FRIDAY', label: 'Friday' },
            { value: 'WEEKEND', label: 'Weekend' },
            { value: 'HOLIDAY', label: 'Holiday' },
            { value: 'DATE', label: 'One dated day (event)' },
          ]}
          onChange={(v) => setKey(v as DayConfigKey)}
        />
        {weekdaysApply ? <WeekdaysEditor value={weekdays} onChange={setWeekdays} /> : null}
        {key === 'DATE' ? (
          <label className="flex items-center gap-1 text-[11.5px]">
            The day
            <input type="date" className="field py-0.5" value={date} aria-label="Event date" onChange={(e) => setDate(e.target.value)} />
          </label>
        ) : null}
        <label className="flex items-center gap-1 text-[11.5px]">
          Effective from
          <input type="date" className="field py-0.5" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>
        <TextField value={label} ariaLabel="Label" placeholder="Label (optional)" onChange={setLabel} />
      </div>

      <table className="rows">
        <thead>
          <tr>
            <th className="w-[40px]">In</th>
            <th>Shift</th>
            <th className="w-[90px]" title="Below this is a gap. Zero is legal — the shift is offered with no coverage obligation.">
              Min
            </th>
            <th className="w-[110px]" title="Above this is a warning. Blank means no ceiling.">
              Max
            </th>
            <th title="The requirement everyone with no other shift falls into on this kind of day">
              Absorbs the rest
            </th>
          </tr>
        </thead>
        <tbody>
          {unitShifts.map((shift) => {
            const row = requirements.get(shift.id);
            return (
              <tr key={shift.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={row !== undefined}
                    aria-label={`${shift.code} runs on this kind of day`}
                    onChange={(e) =>
                      setRequirements((prev) => {
                        const map = new Map(prev);
                        if (e.target.checked) map.set(shift.id, { min: 0, max: null, isDefault: false });
                        else map.delete(shift.id);
                        return map;
                      })
                    }
                  />
                </td>
                <td>
                  <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: shift.color }} />
                  <span className="font-mono text-[12px]">{shift.code}</span>
                  <span className="ml-2 text-[11px] text-faint">{shift.label}</span>
                </td>
                <td>
                  <NumberField
                    min={0}
                    value={row?.min ?? 0}
                    ariaLabel={`${shift.code} minimum`}
                    onChange={(v) => patch(shift.id, { min: v })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    className="field w-16 py-0.5 font-mono text-[12px]"
                    value={row?.max ?? ''}
                    placeholder="—"
                    disabled={row === undefined}
                    aria-label={`${shift.code} maximum`}
                    onChange={(e) => patch(shift.id, { max: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={row?.isDefault ?? false}
                    disabled={row === undefined}
                    aria-label={`${shift.code} absorbs everyone else`}
                    onChange={(e) => patch(shift.id, { isDefault: e.target.checked })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {error ? <p className="text-[11px] text-warn">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={
            !effectiveFrom ||
            requirements.size === 0 ||
            (key === 'DATE' && !date) ||
            (weekdaysApply && weekdays.length === 0) ||
            create.isPending
          }
          onClick={() => void submit()}
        >
          {create.isPending ? 'Creating…' : 'Create new version'}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          title="Close without creating a new version"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------
