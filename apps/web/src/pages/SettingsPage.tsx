/**
 * Settings — full CRUD administration (Phase 6), updated for Phase 8's unit
 * model.
 *
 * Region is gone: the Regions tab is gone too, and everything it used to own
 * (name, primary location, member locations, comp-off policy) now lives on
 * the Units tab, alongside Kind/GroupBy which were always PlanningUnit's.
 * Shifts and Roles used to be two tabs backed by two entities
 * (`ShiftDefinition`/`ShiftRole`); Phase 8 merged them into one `Shift`
 * entity with an absolute window, so there is one Shifts tab now.
 *
 * Colors, labels and display names are edited in place, same as any other
 * unversioned attribute (CLAUDE.md point 14). Day configurations are the one
 * exception: `resolveDayConfiguration`/`DayConfigurationResolver` already
 * pick the latest applicable `effectiveFrom`, so the only edit action offered
 * for them is "create a new version" — the version history stays visible
 * below it, never overwritten (ADR-0021). The create form spells that out in
 * plain language (CLAUDE.md: the old screen didn't say what action it took),
 * and the current/live version is visually set apart from its history, not a
 * flat list.
 *
 * Nothing here hits the network per keystroke. Every tab reads its rows
 * through `draftOf` (`useAdminEdits`), which overlays any pending edit on
 * top of the server value; the dirty bar's Save All is what actually calls
 * the mutations, all at once, and Cancel just clears the pending map — see
 * `useAdminEdits.ts` for why that needs no per-row reset logic.
 */

import { useId, useState, type ReactElement } from 'react';
import {
  adminAbsenceCapacityRules,
  adminHolidays,
  adminLocations,
  adminPeople,
  adminShifts,
  adminUnits,
  absenceCapacityRuleToWire,
  holidayToWire,
  locationToWire,
  personAdminToWire,
  shiftToWire,
  unitToWire,
  useCreateDayConfigVersion,
  type AdminPersonSummary,
} from '../api/admin.ts';
import { weekdaysToWire } from '../api/mapping.ts';
import type {
  AbsenceCapacityRule,
  DayConfigKey,
  Holiday,
  Location,
  PlanningUnit,
  Shift,
  ShiftRequirement,
  Weekday,
} from '../domain/types.ts';
import { DirtyBar } from '../features/settings/DirtyBar.tsx';
import { CheckboxField, FieldErrorList, NativeSelectField, NumberField, TextField, TimeField } from '../features/settings/fields.tsx';
import { type AdminEntity, type EntityOps, useAdminEdits } from '../features/settings/useAdminEdits.ts';
import { useSchedule } from '../store/useSchedule.ts';

const TABS = [
  'Units',
  'Locations',
  'Shifts',
  'Day configurations',
  'Holidays',
  'Absence limits',
  'People',
] as const;
type Tab = (typeof TABS)[number];

const WEEKDAY_LABELS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

function WeekdaysEditor({ value, onChange }: { readonly value: readonly Weekday[]; readonly onChange: (v: Weekday[]) => void }) {
  const set = new Set(value);
  return (
    <div className="flex gap-1">
      {WEEKDAY_LABELS.map((d) => (
        <button
          key={d.value}
          type="button"
          className="day-chip"
          data-selected={set.has(d.value)}
          onClick={() => {
            const next = new Set(set);
            if (next.has(d.value)) next.delete(d.value);
            else next.add(d.value);
            onChange([...next].sort((a, b) => a - b));
          }}
        >
          <span className="day-chip__num text-[10.5px]">{d.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Units');
  const reference = useSchedule((s) => s.reference);
  const edits = useAdminEdits();

  // One mutation-hook instance per entity, called unconditionally (rules of
  // hooks) — `opsByEntity` below wires each into the generic save/cancel loop.
  const locationOps = adminLocations;
  const locCreate = locationOps.useCreate();
  const locUpdate = locationOps.useUpdate();
  const locRemove = locationOps.useRemove();

  const holCreate = adminHolidays.useCreate();
  const holUpdate = adminHolidays.useUpdate();
  const holRemove = adminHolidays.useRemove();

  const unitCreate = adminUnits.useCreate();
  const unitUpdate = adminUnits.useUpdate();
  const unitRemove = adminUnits.useRemove();

  const acrCreate = adminAbsenceCapacityRules.useCreate();
  const acrUpdate = adminAbsenceCapacityRules.useUpdate();
  const acrRemove = adminAbsenceCapacityRules.useRemove();

  const shiftCreate = adminShifts.useCreate();
  const shiftUpdate = adminShifts.useUpdate();
  const shiftRemove = adminShifts.useRemove();

  const personCreate = adminPeople.useCreate();
  const personUpdate = adminPeople.useUpdate();
  const personRemove = adminPeople.useRemove();

  const opsByEntity: Partial<Record<AdminEntity, EntityOps<never, never>>> = {
    location: {
      create: (r) => locCreate.mutateAsync(r as never),
      update: (id, r) => locUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => locRemove.mutateAsync(id),
      toRequest: (d) => locationToWire(d as never) as never,
    },
    holiday: {
      create: (r) => holCreate.mutateAsync(r as never),
      update: (id, r) => holUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => holRemove.mutateAsync(id),
      toRequest: (d) => holidayToWire(d as never) as never,
    },
    unit: {
      create: (r) => unitCreate.mutateAsync(r as never),
      update: (id, r) => unitUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => unitRemove.mutateAsync(id),
      toRequest: (d) => unitToWire(d as never) as never,
    },
    absenceCapacityRule: {
      create: (r) => acrCreate.mutateAsync(r as never),
      update: (id, r) => acrUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => acrRemove.mutateAsync(id),
      toRequest: (d) => absenceCapacityRuleToWire(d as never) as never,
    },
    shift: {
      create: (r) => shiftCreate.mutateAsync(r as never),
      update: (id, r) => shiftUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => shiftRemove.mutateAsync(id),
      toRequest: (d) => shiftToWire(d as never) as never,
    },
    person: {
      create: (r) => personCreate.mutateAsync(r as never),
      update: (id, r) => personUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => personRemove.mutateAsync(id),
      toRequest: (d) => personAdminToWire(d as never) as never,
    },
  };

  if (!reference) return null;

  const saving = edits.saving;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <span className="text-[11.5px] text-faint">
          Day configurations and shifts are versioned by effective date — see ADR&#8209;0021
        </span>
      </header>

      <DirtyBar
        dirtyCount={edits.dirtyCount}
        saving={saving}
        onSaveAll={() => void edits.saveAll(opsByEntity)}
        onCancelAll={edits.cancelAll}
      />

      <div className="segmented self-start">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className="segmented__item"
            data-active={tab === item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <section className="card overflow-auto">
        {tab === 'Units' ? <UnitsTab reference={reference} edits={edits} /> : null}
        {tab === 'Locations' ? <LocationsTab reference={reference} edits={edits} /> : null}
        {tab === 'Shifts' ? <ShiftsTab reference={reference} edits={edits} /> : null}
        {tab === 'Day configurations' ? <DayConfigurationsTab reference={reference} /> : null}
        {tab === 'Holidays' ? <HolidaysTab reference={reference} edits={edits} /> : null}
        {tab === 'Absence limits' ? <AbsenceLimitsTab reference={reference} edits={edits} /> : null}
        {tab === 'People' ? <PeopleTab reference={reference} edits={edits} /> : null}
      </section>
    </div>
  );
}

type Reference = NonNullable<ReturnType<typeof useSchedule.getState>['reference']>;
type Edits = ReturnType<typeof useAdminEdits>;

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function LocationsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="location"
      rows={reference.locations}
      entity="location"
      edits={edits}
      newTempId={tempId}
      newInitial={{ name: '', country: '', timeZone: '', holidayCalendarKey: '', weekendDays: [6, 7] }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Country</th>
          <th>Time zone</th>
          <th>Holiday calendar</th>
          <th>Weekend</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Location, setField, errors) => (
        <>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td>
            <TextField value={draft.country} ariaLabel="Country" onChange={(v) => setField('country', v)} />
          </td>
          <td>
            <TextField mono value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
          </td>
          <td>
            <TextField mono value={draft.holidayCalendarKey} ariaLabel="Holiday calendar key" onChange={(v) => setField('holidayCalendarKey', v)} />
          </td>
          <td>
            <WeekdaysEditor value={draft.weekendDays} onChange={(v) => setField('weekendDays', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Shifts — Phase 8 merged the old ShiftRole/ShiftDefinition split
// ---------------------------------------------------------------------------

function ShiftsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="shift"
      rows={reference.shifts}
      entity="shift"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        unitId: reference.units[0]?.id ?? '',
        code: '',
        label: '',
        color: '#888888',
        timeZone: reference.units[0]?.locationIds[0] ? reference.locations.find((l) => l.id === reference.units[0]?.locationIds[0])?.timeZone ?? '' : '',
        start: '09:00',
        end: '18:00',
        crossesMidnight: false,
        breakMinutes: 0,
        countsAsCoverage: true,
        editableTime: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Unit</th>
          <th>Code</th>
          <th>Label</th>
          <th>Color</th>
          <th>Hotkey</th>
          <th>Window</th>
          <th>Zone</th>
          <th>Counts as coverage</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Shift, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => setField('unitId', v)}
            />
          </td>
          <td>
            <TextField mono value={draft.code} ariaLabel="Code" onChange={(v) => setField('code', v)} />
            <FieldErrorList errors={errors?.code} />
          </td>
          <td>
            <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
          </td>
          <td>
            <input
              type="color"
              value={draft.color}
              aria-label="Color"
              onChange={(e) => setField('color', e.target.value)}
            />
          </td>
          <td>
            <TextField mono value={draft.hotkey ?? ''} ariaLabel="Hotkey" onChange={(v) => setField('hotkey', v || undefined)} />
          </td>
          <td className="flex items-center gap-1">
            <TimeField value={draft.start} ariaLabel="Start" onChange={(v) => setField('start', v)} />
            <span className="text-faint">–</span>
            <TimeField value={draft.end} ariaLabel="End" onChange={(v) => setField('end', v)} />
          </td>
          <td>
            <TextField mono value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
          </td>
          <td>
            <CheckboxField checked={draft.countsAsCoverage} ariaLabel="Counts as coverage" onChange={(v) => setField('countsAsCoverage', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Day configurations — history + create-new-version
// ---------------------------------------------------------------------------

function describeKey(config: { key: DayConfigKey; date?: string }): string {
  if (config.date) return `Event on ${config.date}`;
  switch (config.key) {
    case 'weekend':
      return 'Weekend';
    case 'holiday':
      return 'Holiday';
    case 'weekday':
      return 'Weekdays';
    case 'friday':
      return 'Friday';
    default:
      return config.key;
  }
}

function DayConfigurationsTab({ reference }: { readonly reference: Reference }) {
  const [creating, setCreating] = useState(false);
  const grouped = new Map<string, typeof reference.dayConfigurations extends readonly (infer T)[] ? T[] : never>();
  for (const config of reference.dayConfigurations) {
    const groupKey = `${config.unitId}|${config.key}|${config.date ?? ''}`;
    const list = grouped.get(groupKey) ?? [];
    list.push(config);
    grouped.set(groupKey, list);
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-faint">
          Every version is kept — editing means creating a new one effective from a future date, never overwriting history.
        </p>
        <button type="button" className="btn btn--sm btn--primary ml-auto" onClick={() => setCreating(true)}>
          + New version
        </button>
      </div>

      {creating ? <NewDayConfigVersionForm reference={reference} onDone={() => setCreating(false)} /> : null}

      {[...grouped.entries()].map(([groupKey, versions]) => {
        const sorted = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
        const [current, ...history] = sorted;
        if (!current) return null;
        return (
          <div key={groupKey} className="card p-2">
            <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2 py-1">
              <span className="pill pill--accent">live</span>
              <span className="text-muted">{current.unitId}</span>
              <span className="font-medium">{describeKey(current)}</span>
              <span className="text-[11px] text-faint">effective since {current.effectiveFrom}</span>
              {history.length > 0 ? (
                <span className="ml-auto text-[11px] text-faint">{history.length} earlier version{history.length > 1 ? 's' : ''}</span>
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
            <span className="text-faint">{requirement.min}</span>
          </span>
        );
      })}
    </span>
  );
}

function NewDayConfigVersionForm({ reference, onDone }: { readonly reference: Reference; readonly onDone: () => void }) {
  const create = useCreateDayConfigVersion();
  const [unitId, setUnitId] = useState(reference.units[0]?.id ?? '');
  const [key, setKey] = useState<DayConfigKey>('weekday');
  const [weekdays, setWeekdays] = useState<Weekday[]>([1, 2, 3, 4]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [label, setLabel] = useState('');
  const [minByShift, setMinByShift] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | undefined>();

  const unitShifts = reference.shifts.filter((s) => s.unitId === unitId);

  async function submit() {
    setError(undefined);
    try {
      await create.mutateAsync({
        unitId,
        key,
        weekdays: weekdaysToWire(weekdays),
        date: null,
        label: label || null,
        effectiveFrom,
        shiftRequirements: [...minByShift.entries()]
          .filter(([, min]) => min > 0)
          .map(([shiftId, min]) => ({
            shiftId,
            min,
            max: null,
            isDefault: false,
            timingOverrideStart: null,
            timingOverrideEnd: null,
            timingOverrideCrossesMidnight: null,
          })),
      });
      onDone();
    } catch {
      setError('Could not create this version — check the effective date and shift minimums.');
    }
  }

  return (
    <div className="card flex flex-col gap-2 border-2 border-accent p-3">
      <p className="text-[12px] text-ink">
        This creates a <strong>new version</strong> of the day configuration for the selected
        unit, effective from the date below — it does <strong>not</strong> edit the currently
        live configuration. Coverage before that date keeps using whatever version applied then
        (ADR&#8209;0021).
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
            { value: 'weekday', label: 'Weekdays' },
            { value: 'friday', label: 'Friday' },
            { value: 'weekend', label: 'Weekend' },
            { value: 'holiday', label: 'Holiday' },
          ]}
          onChange={(v) => setKey(v as DayConfigKey)}
        />
        <WeekdaysEditor value={weekdays} onChange={setWeekdays} />
        <label className="flex items-center gap-1 text-[11.5px]">
          Effective from
          <input type="date" className="field py-0.5" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>
        <TextField value={label} ariaLabel="Label" placeholder="Label (optional)" onChange={setLabel} />
      </div>

      <div className="flex flex-wrap gap-3">
        {unitShifts.map((shift) => (
          <label key={shift.id} className="flex items-center gap-1.5 text-[11.5px]">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: shift.color }} />
            {shift.code}
            <NumberField
              min={0}
              value={minByShift.get(shift.id) ?? 0}
              ariaLabel={`${shift.code} minimum`}
              onChange={(v) => setMinByShift(new Map(minByShift).set(shift.id, v))}
            />
          </label>
        ))}
      </div>

      {error ? <p className="text-[11px] text-warn">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!effectiveFrom || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Creating…' : 'Create new version'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDone}>
          Cancel — do not create anything
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

function HolidaysTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const sorted = [...reference.holidays].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <EditableTable
      title="holiday"
      rows={sorted}
      entity="holiday"
      edits={edits}
      newTempId={tempId}
      newInitial={{ date: '', name: '', locationIds: [], isFullDay: true }}
      renderHeader={() => (
        <tr>
          <th>Date</th>
          <th>Name</th>
          <th>Locations</th>
          <th>Full day</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Holiday, setField, errors) => (
        <>
          <td>
            <input type="date" className="field py-0.5 font-mono text-[12px]" value={draft.date} onChange={(e) => setField('date', e.target.value)} />
          </td>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td className="flex flex-wrap gap-2">
            {reference.locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.locationIds.includes(loc.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.locationIds, loc.id]
                      : draft.locationIds.filter((id) => id !== loc.id);
                    setField('locationIds', next);
                  }}
                />
                {loc.name}
              </label>
            ))}
          </td>
          <td>
            <CheckboxField checked={draft.isFullDay} ariaLabel="Full day" onChange={(v) => setField('isFullDay', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Units — Phase 8 merged what used to be Region here: name, primary
// location, member locations, comp-off policy, alongside Kind/GroupBy.
// ---------------------------------------------------------------------------

const DEFAULT_COMP_OFF = {
  windowBeforeDays: 14,
  windowAfterDays: 14,
  excludedWeekdays: [1, 5] as Weekday[],
  agingThresholdDays: 14,
  requiresApprovalWhenNoSlot: true,
};

function UnitsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="unit"
      rows={reference.units}
      entity="unit"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        name: '',
        kind: 'CROSS_REGION',
        groupBy: 'LOCATION',
        primaryLocationId: reference.locations[0]?.id ?? '',
        locationIds: reference.locations[0] ? [reference.locations[0].id] : [],
        compOffPolicy: DEFAULT_COMP_OFF,
      }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Group by</th>
          <th>Primary location</th>
          <th>Member locations</th>
          <th>Comp-off before / after</th>
          <th>Aging threshold</th>
          <th />
        </tr>
      )}
      renderRow={(draft: PlanningUnit, setField, errors) => (
        <>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td>
            <NativeSelectField
              value={draft.kind}
              ariaLabel="Kind"
              options={[{ value: 'REGION', label: 'Region' }, { value: 'CROSS_REGION', label: 'Cross-region' }]}
              onChange={(v) => setField('kind', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.groupBy}
              ariaLabel="Group by"
              options={[
                { value: 'LOCATION', label: 'Location' },
                { value: 'REGION', label: 'Region (legacy — no data uses this)' },
                { value: 'ORG_CATEGORY', label: 'Org category' },
              ]}
              onChange={(v) => setField('groupBy', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.primaryLocationId}
              ariaLabel="Primary location"
              options={reference.locations.map((l) => ({ value: l.id, label: l.name }))}
              onChange={(v) => setField('primaryLocationId', v)}
            />
            <FieldErrorList errors={errors?.primaryLocationId} />
          </td>
          <td className="flex max-w-[220px] flex-wrap gap-2">
            {reference.locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.locationIds.includes(loc.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.locationIds, loc.id]
                      : draft.locationIds.filter((id) => id !== loc.id);
                    setField('locationIds', next);
                  }}
                />
                {loc.name}
              </label>
            ))}
            <FieldErrorList errors={errors?.locationIds} />
          </td>
          <td className="flex items-center gap-1.5">
            <NumberField
              value={draft.compOffPolicy.windowBeforeDays}
              ariaLabel="Comp-off window before"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, windowBeforeDays: v })}
            />
            <span className="text-faint">/</span>
            <NumberField
              value={draft.compOffPolicy.windowAfterDays}
              ariaLabel="Comp-off window after"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, windowAfterDays: v })}
            />
            <span className="text-faint">days</span>
          </td>
          <td>
            <NumberField
              value={draft.compOffPolicy.agingThresholdDays}
              ariaLabel="Comp-off aging threshold"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, agingThresholdDays: v })}
            />
            <span className="ml-1 text-faint">days</span>
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Absence capacity rules
// ---------------------------------------------------------------------------

function AbsenceLimitsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="absence-capacity rule"
      rows={reference.absenceCapacityRules}
      entity="absenceCapacityRule"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        unitId: reference.units[0]?.id ?? '',
        scope: { kind: 'UNIT' },
        durationBucket: 'SHORT',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION', 'SICK'],
        countsCompDays: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Unit</th>
          <th>Scope</th>
          <th>Duration</th>
          <th>Max concurrent</th>
          <th>Counts comp days</th>
          <th />
        </tr>
      )}
      renderRow={(draft: AbsenceCapacityRule, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => setField('unitId', v)}
            />
          </td>
          <td className="flex items-center gap-1">
            <NativeSelectField
              value={draft.scope.kind}
              ariaLabel="Scope"
              options={[{ value: 'UNIT', label: 'Unit-wide' }, { value: 'SHIFT_POOL', label: 'Shift pool' }]}
              onChange={(v) =>
                setField('scope', v === 'SHIFT_POOL' ? { kind: 'SHIFT_POOL', shiftId: reference.shifts[0]?.id ?? '' } : { kind: 'UNIT' })
              }
            />
            {draft.scope.kind === 'SHIFT_POOL' ? (
              <NativeSelectField
                value={draft.scope.shiftId}
                ariaLabel="Shift pool"
                options={reference.shifts.filter((s) => s.unitId === draft.unitId).map((s) => ({ value: s.id, label: s.code }))}
                onChange={(v) => setField('scope', { kind: 'SHIFT_POOL', shiftId: v })}
              />
            ) : null}
            <FieldErrorList errors={errors?.scopeShiftId} />
          </td>
          <td>
            <NativeSelectField
              value={draft.durationBucket}
              ariaLabel="Duration bucket"
              options={[{ value: 'SHORT', label: 'Short' }, { value: 'LONG', label: 'Long' }]}
              onChange={(v) => setField('durationBucket', v)}
            />
          </td>
          <td>
            <NumberField min={0} value={draft.maxConcurrent} ariaLabel="Max concurrent" onChange={(v) => setField('maxConcurrent', v)} />
          </td>
          <td>
            <CheckboxField checked={draft.countsCompDays} ariaLabel="Counts comp days" onChange={(v) => setField('countsCompDays', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// People — identity fields only (eligibility/preferences: People page)
// ---------------------------------------------------------------------------

function PeopleTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const rows: AdminPersonSummary[] = reference.people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    initials: p.initials,
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    unitId: p.unitId,
    locationId: p.locationId,
    orgCategory: p.orgCategory,
    isActive: p.isActive,
    isIncluded: p.isIncluded,
  }));
  return (
    <EditableTable
      title="person"
      rows={rows}
      entity="person"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        displayName: '',
        initials: '',
        unitId: reference.units[0]?.id ?? '',
        locationId: reference.locations[0]?.id ?? '',
        orgCategory: 'SUPPORT',
        isActive: true,
        isIncluded: true,
      }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Initials</th>
          <th>Unit</th>
          <th>Location</th>
          <th>Active</th>
          <th>Included</th>
          <th />
        </tr>
      )}
      renderRow={(draft: AdminPersonSummary, setField, errors) => (
        <>
          <td>
            <TextField value={draft.displayName} ariaLabel="Name" onChange={(v) => setField('displayName', v)} />
            <FieldErrorList errors={errors?.displayName} />
          </td>
          <td>
            <TextField mono value={draft.initials} ariaLabel="Initials" onChange={(v) => setField('initials', v)} />
          </td>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => setField('unitId', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.locationId}
              ariaLabel="Location"
              options={reference.locations.map((l) => ({ value: l.id, label: l.name }))}
              onChange={(v) => setField('locationId', v)}
            />
          </td>
          <td>
            <CheckboxField checked={draft.isActive} ariaLabel="Active" onChange={(v) => setField('isActive', v)} />
          </td>
          <td>
            <CheckboxField checked={draft.isIncluded} ariaLabel="Included" onChange={(v) => setField('isIncluded', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Generic editable table: existing rows + one pending "new row" + delete
// ---------------------------------------------------------------------------

function EditableTable<T extends { readonly id: string }>({
  title,
  rows,
  entity,
  edits,
  newTempId,
  newInitial,
  renderHeader,
  renderRow,
}: {
  readonly title: string;
  readonly rows: readonly T[];
  readonly entity: AdminEntity;
  readonly edits: Edits;
  readonly newTempId: string;
  readonly newInitial: Record<string, unknown>;
  readonly renderHeader: () => ReactElement;
  readonly renderRow: (
    draft: T,
    setField: (field: string, value: unknown) => void,
    errors: ReturnType<Edits['fieldErrorsFor']>,
  ) => ReactElement;
}) {
  const creating = edits.pendingCreates.some((c) => c.entity === entity && c.tempId === newTempId);

  return (
    <table className="rows">
      <thead>{renderHeader()}</thead>
      <tbody>
        {rows.map((row) => {
          const draft = edits.draftOf(entity, row.id, row as unknown as Record<string, unknown>) as unknown as T;
          const markedForDelete = edits.isMarkedForDelete(entity, row.id);
          const errors = edits.fieldErrorsFor(entity, row.id);
          return (
            <tr key={row.id} className={markedForDelete ? 'opacity-40' : undefined}>
              {renderRow(
                draft,
                (field, value) => edits.setField(entity, row.id, field, value, draft as unknown as Record<string, unknown>),
                errors,
              )}
              <td>
                {markedForDelete ? (
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => edits.discardOne(entity, row.id)}>
                    Undo
                  </button>
                ) : (
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => edits.markDelete(entity, row.id)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          );
        })}

        {creating ? (
          <tr>
            {renderRow(
              newInitial as unknown as T,
              (field, value) => edits.setCreateField(entity, newTempId, field, value),
              edits.fieldErrorsFor(entity, `new:${newTempId}`),
            )}
            <td>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => edits.discardOne(entity, `new:${newTempId}`)}>
                Discard
              </button>
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={20}>
            {!creating ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => edits.startCreate(entity, newTempId, newInitial)}
              >
                + New {title}
              </button>
            ) : null}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
