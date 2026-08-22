/**
 * Settings — full CRUD administration (Phase 6).
 *
 * Colors, labels and display names are edited in place, same as any other
 * unversioned attribute (CLAUDE.md point 14). Day configurations are the one
 * exception: `resolveDayConfiguration`/`DayConfigurationResolver` already
 * pick the latest applicable `effectiveFrom`, so the only edit action offered
 * for them is "create a new version" — the version history stays visible
 * below it, never overwritten (ADR-0021).
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
  adminRoles,
  adminShifts,
  adminUnits,
  absenceCapacityRuleToWire,
  holidayToWire,
  locationToWire,
  personAdminToWire,
  regionToWire,
  roleToWire,
  shiftToWire,
  unitToWire,
  useCreateDayConfigVersion,
  useUpdateAdminRegion,
  type AdminPersonSummary,
} from '../api/admin.ts';
import { weekdaysToWire } from '../api/mapping.ts';
import type {
  AbsenceCapacityRule,
  AbsenceType,
  DayConfigKey,
  Holiday,
  Location,
  PlanningUnit,
  Region,
  RoleRequirement,
  ShiftDefinition,
  ShiftRole,
  Weekday,
} from '../domain/types.ts';
import { DirtyBar } from '../features/settings/DirtyBar.tsx';
import { CheckboxField, FieldErrorList, NativeSelectField, NumberField, TextField, TimeField } from '../features/settings/fields.tsx';
import { type AdminEntity, type EntityOps, useAdminEdits } from '../features/settings/useAdminEdits.ts';
import { useSchedule } from '../store/useSchedule.ts';

const TABS = [
  'Regions',
  'Locations',
  'Roles',
  'Shifts',
  'Day configurations',
  'Holidays',
  'Units',
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
  const [tab, setTab] = useState<Tab>('Regions');
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

  const roleCreate = adminRoles.useCreate();
  const roleUpdate = adminRoles.useUpdate();
  const roleRemove = adminRoles.useRemove();

  const personCreate = adminPeople.useCreate();
  const personUpdate = adminPeople.useUpdate();
  const personRemove = adminPeople.useRemove();

  const regionUpdate = useUpdateAdminRegion();

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
    role: {
      create: (r) => roleCreate.mutateAsync(r as never),
      update: (id, r) => roleUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => roleRemove.mutateAsync(id),
      toRequest: (d) => roleToWire(d as never) as never,
    },
    person: {
      create: (r) => personCreate.mutateAsync(r as never),
      update: (id, r) => personUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => personRemove.mutateAsync(id),
      toRequest: (d) => personAdminToWire(d as never) as never,
    },
    region: {
      create: () => Promise.resolve(),
      update: (id, r) => regionUpdate.mutateAsync({ id, body: r as never }),
      remove: () => Promise.resolve(),
      toRequest: (d) => regionToWire(d as never) as never,
    },
  };

  if (!reference) return null;

  const saving = edits.saving;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <span className="text-[11.5px] text-faint">
          Day configurations, shifts and roles are versioned by effective date — see ADR&#8209;0021
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
        {tab === 'Regions' ? <RegionsTab reference={reference} edits={edits} /> : null}
        {tab === 'Locations' ? <LocationsTab reference={reference} edits={edits} /> : null}
        {tab === 'Roles' ? <RolesTab reference={reference} edits={edits} /> : null}
        {tab === 'Shifts' ? <ShiftsTab reference={reference} edits={edits} /> : null}
        {tab === 'Day configurations' ? <DayConfigurationsTab reference={reference} /> : null}
        {tab === 'Holidays' ? <HolidaysTab reference={reference} edits={edits} /> : null}
        {tab === 'Units' ? <UnitsTab reference={reference} edits={edits} /> : null}
        {tab === 'Absence limits' ? <AbsenceLimitsTab reference={reference} edits={edits} /> : null}
        {tab === 'People' ? <PeopleTab reference={reference} edits={edits} /> : null}
      </section>
    </div>
  );
}

type Reference = NonNullable<ReturnType<typeof useSchedule.getState>['reference']>;
type Edits = ReturnType<typeof useAdminEdits>;

// ---------------------------------------------------------------------------
// Regions — in place only, no add/delete
// ---------------------------------------------------------------------------

function RegionsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  return (
    <table className="rows">
      <thead>
        <tr>
          <th>Region</th>
          <th>Name</th>
          <th>Primary zone</th>
          <th>Comp-off before / after</th>
        </tr>
      </thead>
      <tbody>
        {reference.regions.map((region) => {
          const draft = edits.draftOf<Region>('region', region.id, region);
          const errors = edits.fieldErrorsFor('region', region.id);
          return (
            <tr key={region.id}>
              <td className="font-mono text-[12px] text-muted">{region.id}</td>
              <td>
                <TextField
                  value={draft.name}
                  ariaLabel={`${region.id} name`}
                  onChange={(v) => edits.setField('region', region.id, 'name', v, draft)}
                />
                <FieldErrorList errors={errors?.name} />
              </td>
              <td>
                <TextField
                  mono
                  value={draft.primaryTimeZone}
                  ariaLabel={`${region.id} primary time zone`}
                  onChange={(v) => edits.setField('region', region.id, 'primaryTimeZone', v, draft)}
                />
              </td>
              <td className="flex items-center gap-1.5">
                <NumberField
                  value={draft.compOffPolicy.windowBeforeDays}
                  ariaLabel={`${region.id} window before`}
                  onChange={(v) =>
                    edits.setField('region', region.id, 'compOffPolicy', { ...draft.compOffPolicy, windowBeforeDays: v }, draft)
                  }
                />
                <span className="text-faint">/</span>
                <NumberField
                  value={draft.compOffPolicy.windowAfterDays}
                  ariaLabel={`${region.id} window after`}
                  onChange={(v) =>
                    edits.setField('region', region.id, 'compOffPolicy', { ...draft.compOffPolicy, windowAfterDays: v }, draft)
                  }
                />
                <span className="text-faint">days</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

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
      newInitial={{ name: '', timeZone: '', holidayCalendarKey: '', weekendDays: [6, 7] }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
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
// Roles
// ---------------------------------------------------------------------------

function RolesTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="role"
      rows={reference.roles}
      entity="role"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        regionId: reference.regions[0]?.id ?? '',
        code: '',
        label: '',
        color: '#888888',
        timeZone: reference.regions[0]?.primaryTimeZone ?? '',
        start: '09:00',
        end: '18:00',
        crossesMidnight: false,
        breakMinutes: 0,
        countsAsCoverage: true,
        editableTime: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Region</th>
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
      renderRow={(draft: ShiftRole, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.regionId}
              ariaLabel="Region"
              options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
              onChange={(v) => setField('regionId', v)}
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
// Shifts
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
        regionId: reference.regions[0]?.id ?? '',
        code: '',
        name: '',
        timeZone: reference.regions[0]?.primaryTimeZone ?? '',
        start: '09:00',
        end: '17:30',
        crossesMidnight: false,
        breakMinutes: 0,
      }}
      renderHeader={() => (
        <tr>
          <th>Region</th>
          <th>Code</th>
          <th>Name</th>
          <th>Window</th>
          <th>Zone</th>
          <th />
        </tr>
      )}
      renderRow={(draft: ShiftDefinition, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.regionId}
              ariaLabel="Region"
              options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
              onChange={(v) => setField('regionId', v)}
            />
          </td>
          <td>
            <TextField mono value={draft.code} ariaLabel="Code" onChange={(v) => setField('code', v)} />
            <FieldErrorList errors={errors?.code} />
          </td>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
          </td>
          <td className="flex items-center gap-1">
            <TimeField value={draft.start} ariaLabel="Start" onChange={(v) => setField('start', v)} />
            <span className="text-faint">–</span>
            <TimeField value={draft.end} ariaLabel="End" onChange={(v) => setField('end', v)} />
          </td>
          <td>
            <TextField mono value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
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
    const groupKey = `${config.regionId}|${config.key}|${config.date ?? ''}`;
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
            <div className="flex items-center gap-2">
              <span className="text-muted">{current.regionId}</span>
              <span className="font-medium">{describeKey(current)}</span>
              <span className="pill pill--accent">effective from {current.effectiveFrom}</span>
              {history.length > 0 ? (
                <span className="text-[11px] text-faint">{history.length} earlier version{history.length > 1 ? 's' : ''}</span>
              ) : null}
            </div>
            <RoleRequirementList reference={reference} requirements={current.roleRequirements} />
            {history.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-faint">Version history</summary>
                {history.map((v) => (
                  <div key={v.id} className="mt-1 border-t border-[var(--border)] pt-1">
                    <span className="text-[11px] text-faint">effective from {v.effectiveFrom}</span>
                    <RoleRequirementList reference={reference} requirements={v.roleRequirements} />
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

function RoleRequirementList({
  reference,
  requirements,
}: {
  readonly reference: Reference;
  readonly requirements: readonly RoleRequirement[];
}) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {requirements.map((requirement) => {
        const role = reference.roles.find((r) => r.id === requirement.roleId);
        return (
          <span
            key={requirement.roleId}
            className="pill"
            title={`${role?.label ?? requirement.roleId}: min ${requirement.min}${requirement.max !== undefined ? `, max ${requirement.max}` : ''}`}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: role?.color ?? 'var(--accent)' }} />
            {role?.code ?? requirement.roleId}
            <span className="text-faint">{requirement.min}</span>
          </span>
        );
      })}
    </span>
  );
}

function NewDayConfigVersionForm({ reference, onDone }: { readonly reference: Reference; readonly onDone: () => void }) {
  const create = useCreateDayConfigVersion();
  const [regionId, setRegionId] = useState(reference.regions[0]?.id ?? '');
  const [key, setKey] = useState<DayConfigKey>('weekday');
  const [weekdays, setWeekdays] = useState<Weekday[]>([1, 2, 3, 4]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [label, setLabel] = useState('');
  const [minByRole, setMinByRole] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | undefined>();

  const regionRoles = reference.roles.filter((r) => r.regionId === regionId);

  async function submit() {
    setError(undefined);
    try {
      await create.mutateAsync({
        regionId,
        key,
        weekdays: weekdaysToWire(weekdays),
        date: null,
        label: label || null,
        effectiveFrom,
        roleRequirements: [...minByRole.entries()]
          .filter(([, min]) => min > 0)
          .map(([roleId, min]) => ({
            roleId,
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
      setError('Could not create this version — check the effective date and role minimums.');
    }
  }

  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelectField
          value={regionId}
          ariaLabel="Region"
          options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
          onChange={setRegionId}
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
        {regionRoles.map((role) => (
          <label key={role.id} className="flex items-center gap-1.5 text-[11.5px]">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: role.color }} />
            {role.code}
            <NumberField
              min={0}
              value={minByRole.get(role.id) ?? 0}
              ariaLabel={`${role.code} minimum`}
              onChange={(v) => setMinByRole(new Map(minByRole).set(role.id, v))}
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
          {create.isPending ? 'Creating…' : 'Create version'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDone}>
          Cancel
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
// Units
// ---------------------------------------------------------------------------

function UnitsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="unit"
      rows={reference.units}
      entity="unit"
      edits={edits}
      newTempId={tempId}
      newInitial={{ name: '', kind: 'CROSS_REGION', groupBy: 'LOCATION' }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Region</th>
          <th>Group by</th>
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
            {draft.kind === 'REGION' ? (
              <NativeSelectField
                value={draft.regionId ?? ''}
                ariaLabel="Region"
                options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
                onChange={(v) => setField('regionId', v)}
              />
            ) : (
              <span className="text-faint">—</span>
            )}
          </td>
          <td>
            <NativeSelectField
              value={draft.groupBy}
              ariaLabel="Group by"
              options={[
                { value: 'LOCATION', label: 'Location' },
                { value: 'REGION', label: 'Region' },
                { value: 'ORG_CATEGORY', label: 'Org category' },
              ]}
              onChange={(v) => setField('groupBy', v)}
            />
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
        regionId: reference.regions[0]?.id ?? '',
        scope: { kind: 'REGION' },
        durationBucket: 'SHORT',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION', 'SICK'] as AbsenceType[],
        countsCompDays: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Region</th>
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
              value={draft.regionId}
              ariaLabel="Region"
              options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
              onChange={(v) => setField('regionId', v)}
            />
          </td>
          <td className="flex items-center gap-1">
            <NativeSelectField
              value={draft.scope.kind}
              ariaLabel="Scope"
              options={[{ value: 'REGION', label: 'Region-wide' }, { value: 'ROLE_POOL', label: 'Role pool' }]}
              onChange={(v) =>
                setField('scope', v === 'ROLE_POOL' ? { kind: 'ROLE_POOL', roleId: reference.roles[0]?.id ?? '' } : { kind: 'REGION' })
              }
            />
            {draft.scope.kind === 'ROLE_POOL' ? (
              <NativeSelectField
                value={draft.scope.roleId}
                ariaLabel="Role pool"
                options={reference.roles.filter((r) => r.regionId === draft.regionId).map((r) => ({ value: r.id, label: r.code }))}
                onChange={(v) => setField('scope', { kind: 'ROLE_POOL', roleId: v })}
              />
            ) : null}
            <FieldErrorList errors={errors?.scopeRoleId} />
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
    regionId: p.regionId,
    unitId: p.unitId,
    locationId: p.locationId,
    defaultShiftId: p.defaultShiftId,
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
        regionId: reference.regions[0]?.id ?? '',
        unitId: reference.units[0]?.id ?? '',
        locationId: reference.locations[0]?.id ?? '',
        defaultShiftId: reference.shifts[0]?.id ?? '',
        orgCategory: 'SUPPORT',
        isActive: true,
        isIncluded: true,
      }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Initials</th>
          <th>Region</th>
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
              value={draft.regionId}
              ariaLabel="Region"
              options={reference.regions.map((r) => ({ value: r.id, label: r.id }))}
              onChange={(v) => setField('regionId', v)}
            />
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
