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

import { useEffect, useId, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import {
  adminAbsenceCapacityRules,
  adminHolidays,
  adminLocations,
  adminEventTypes,
  adminPresenceTypes,
  adminPeople,
  usePeopleBatch,
  PeopleBatchError,
  type PersonAdminRequest,
  adminShifts,
  adminUnits,
  absenceCapacityRuleToWire,
  eventTypeToWire,
  presenceTypeToWire,
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
  DayConfiguration,
  DayConfigKey,
  EventType,
  Holiday,
  Location,
  PlanningUnit,
  PresenceType,
  Shift,
  ShiftRequirement,
  Weekday,
} from '../domain/types.ts';
import { DirtyBar } from '../features/settings/DirtyBar.tsx';
import { HolidayImport } from '../features/settings/HolidayImport.tsx';
import {
  CheckboxField,
  FieldErrorList,
  NativeSelectField,
  NumberField,
  TextField,
  TimeField,
  TimeZoneField,
} from '../features/settings/fields.tsx';
import {
  BatchRejected,
  type AdminEntity,
  type EntityOps,
  useAdminEdits,
} from '../features/settings/useAdminEdits.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { APP_ROLES, type AppRole } from '../auth/AuthProvider.tsx';
import { useCapabilities } from '../auth/useCapabilities.ts';
import { useGrantRole, useRevokeRole, useRoleAssignments } from '../api/roleAssignments.ts';
import { useCanLoadDemoData, useLoadDemoData, useResetSystem } from '../api/setup.ts';
import { ApiError } from '../api/client.ts';
import { toast } from '../ui/toasts.ts';
import { NotificationsTab } from '../features/settings/NotificationsTab.tsx';

const TABS = [
  'Units',
  'Locations',
  'Shifts',
  'Day configs',
  'Holidays',
  'Absence limits',
  'Leave types',
  'Presence',
  'People',
  'Roles',
  'Notifications',
  'Maintenance',
] as const;
type Tab = (typeof TABS)[number];

/** Which entity a tab edits, so the tab can carry that entity's unsaved/rejected count. */
const ENTITY_OF_TAB: Partial<Record<Tab, AdminEntity>> = {
  Units: 'unit',
  Locations: 'location',
  Shifts: 'shift',
  Holidays: 'holiday',
  'Absence limits': 'absenceCapacityRule',
  'Leave types': 'eventType',
  Presence: 'presenceType',
  People: 'person',
};

const WEEKDAY_LABELS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

/** The URL slug for a tab: `Absence limits` ↔ `absence-limits`. */
function slugOf(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Which tab is open, in the query string.
 *
 * WHY: it was `useState`, so a refresh, a browser Back, or a link to "the Roles tab"
 * all landed on Units — on an eleven-tab screen where the answer somebody was sent for
 * is three tabs away. `replace` keeps tab-switching out of the history stack, so Back
 * still leaves Settings rather than walking the tabs backwards.
 */
function useTabInUrl(): readonly [Tab, (tab: Tab) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = TABS.find((t) => slugOf(t) === params.get('tab'));
  return [
    fromUrl ?? 'Units',
    (tab: Tab) => {
      const next = new URLSearchParams(params);
      next.set('tab', slugOf(tab));
      setParams(next, { replace: true });
    },
  ];
}

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
  const [tab, setTab] = useTabInUrl();
  const caps = useCapabilities();
  const reference = useSchedule((s) => s.reference);
  const edits = useAdminEdits();
  const setUnsavedAdminChanges = useUi((s) => s.setUnsavedAdminChanges);

  // Two ways off this screen, and both used to take the edits with them silently: the
  // masthead (which reads the count from `useUi`) and closing the tab.
  useEffect(() => {
    setUnsavedAdminChanges(edits.dirtyCount);
    return () => setUnsavedAdminChanges(0);
  }, [edits.dirtyCount, setUnsavedAdminChanges]);

  useEffect(() => {
    if (edits.dirtyCount === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edits.dirtyCount]);

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

  const eventTypeCreate = adminEventTypes.useCreate();
  const eventTypeUpdate = adminEventTypes.useUpdate();

  const presenceTypeCreate = adminPresenceTypes.useCreate();
  const presenceTypeUpdate = adminPresenceTypes.useUpdate();
  const presenceTypeRemove = adminPresenceTypes.useRemove();

  const personCreate = adminPeople.useCreate();
  const personUpdate = adminPeople.useUpdate();
  const personRemove = adminPeople.useRemove();
  const peopleBatch = usePeopleBatch();

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
    eventType: {
      create: (r) => eventTypeCreate.mutateAsync(r as never),
      update: (id, r) => eventTypeUpdate.mutateAsync({ id, body: r as never }),
      // No delete: a retired kind is `isActive: false`, because absences point at these
      // by id and a deleted one leaves rows nobody can name (ADR-0049).
      remove: () => Promise.resolve(),
      toRequest: (d) => eventTypeToWire(d as never) as never,
    },
    presenceType: {
      create: (r) => presenceTypeCreate.mutateAsync(r as never),
      update: (id, r) => presenceTypeUpdate.mutateAsync({ id, body: r as never }),
      // The server refuses this once anything points at the type, and says to untick
      // Offered instead.
      remove: (id) => presenceTypeRemove.mutateAsync(id),
      toRequest: (d) => presenceTypeToWire(d as never) as never,
    },
    person: {
      create: (r) => personCreate.mutateAsync(r as never),
      update: (id, r) => personUpdate.mutateAsync({ id, body: r as never }),
      remove: (id) => personRemove.mutateAsync(id),
      toRequest: (d) => personAdminToWire(d as never) as never,
      // People are the one admin resource whose rows can invalidate each other: `email`
      // and `employeeId` are uniquely indexed, so moving an address between two people is
      // a release and a claim that are only valid together. Row at a time, the claim was
      // rejected and the release still committed — the address ended up on nobody, and
      // whoever it belonged to could not sign in (ADR-0061).
      saveBatch: async (ops) => {
        try {
          await peopleBatch.mutateAsync(
            ops.map((op) => ({
              kind: op.kind,
              ...(op.id ? { id: op.id } : {}),
              ...(op.tempId ? { tempId: op.tempId } : {}),
              ...(op.request ? { person: op.request as PersonAdminRequest } : {}),
            })),
          );
        } catch (error) {
          if (error instanceof PeopleBatchError) throw new BatchRejected(error.byIndex);
          throw error;
        }
      },
    },
  };

  if (!reference) return null;

  const saving = edits.saving;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        {/* It used to say shifts were versioned too. They are edited in place — only day
            configurations keep every version (ADR-0021), and saying otherwise invited
            somebody to expect last March to be safe from a change to a shift's window. */}
        <span className="text-[11.5px] text-faint">
          Day configurations are versioned by effective date; everything else is edited in place
        </span>
      </header>

      <DirtyBar
        dirtyCount={edits.dirtyCount}
        saving={saving}
        // The result was computed and thrown away, so a partial save — three rows written,
        // two rejected — was communicated only by the fact that two rows stayed dirty.
        onSaveAll={() => {
          void edits.saveAll(opsByEntity).then((result) => {
            if (result.failure) toast.bad(result.failure);
            else if (result.ok) toast.ok(`Saved ${result.savedCount} ${rowWord(result.savedCount)}.`);
            else
              toast.bad(
                `Saved ${result.savedCount}; ${result.failedCount} ${rowWord(result.failedCount)} rejected — see the highlighted fields.`,
              );
          });
        }}
        onCancelAll={edits.cancelAll}
      />

      <div className="segmented flex-wrap self-start">
        {TABS.map((item) => {
          const entity = ENTITY_OF_TAB[item];
          const dirty = entity ? edits.countsByEntity.dirty.get(entity) ?? 0 : 0;
          const failed = entity ? edits.countsByEntity.failed.get(entity) ?? 0 : 0;
          return (
            <button
              key={item}
              type="button"
              className="segmented__item"
              data-active={tab === item}
              onClick={() => setTab(item)}
              title={
                failed > 0
                  ? `${failed} rejected ${rowWord(failed)} on this tab`
                  : dirty > 0
                    ? `${dirty} unsaved ${rowWord(dirty)} on this tab`
                    : undefined
              }
            >
              {item}
              {dirty > 0 ? (
                <span className={`ml-1.5 pill ${failed > 0 ? 'pill--bad' : 'pill--warn'}`}>{failed > 0 ? failed : dirty}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="card overflow-auto">
        {tab === 'Units' ? <UnitsTab reference={reference} edits={edits} /> : null}
        {tab === 'Locations' ? <LocationsTab reference={reference} edits={edits} /> : null}
        {tab === 'Shifts' ? <ShiftsTab reference={reference} edits={edits} /> : null}
        {tab === 'Day configs' ? <DayConfigurationsTab reference={reference} /> : null}
        {tab === 'Holidays' ? <HolidaysTab reference={reference} edits={edits} /> : null}
        {tab === 'Absence limits' ? <AbsenceLimitsTab reference={reference} edits={edits} /> : null}
        {tab === 'Leave types' ? <EventTypesTab reference={reference} edits={edits} /> : null}
        {tab === 'Presence' ? <PresenceTypesTab reference={reference} edits={edits} /> : null}
        {tab === 'People' ? <PeopleTab reference={reference} edits={edits} /> : null}
        {tab === 'Roles' ? <RolesTab reference={reference} /> : null}
        {tab === 'Notifications' ? <NotificationsTab canEdit={caps.canAdministerGlobally} /> : null}
        {tab === 'Maintenance' ? <MaintenanceTab /> : null}
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
            <TimeZoneField value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
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
          <th className="w-[80px]" title="The window ends on the next day — 22:00–06:00 is one shift, not an eight-hour gap">
            Overnight
          </th>
          <th className="w-[80px]">Break</th>
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
            {/* Read by `engine/dates.ts` to place the end of the window on the next day. It
                was stored and editable nowhere, so a night shift created here came out as a
                window running backwards. */}
            <CheckboxField
              checked={draft.crossesMidnight}
              ariaLabel="Crosses midnight"
              onChange={(v) => setField('crossesMidnight', v)}
            />
          </td>
          <td>
            <NumberField
              min={0}
              value={draft.breakMinutes}
              ariaLabel="Break minutes"
              onChange={(v) => setField('breakMinutes', v)}
            />
            <span className="ml-1 text-faint">min</span>
            <FieldErrorList errors={errors?.breakMinutes} />
          </td>
          <td>
            <TimeZoneField value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
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
  const [key, setKey] = useState<DayConfigKey>(seed?.key ?? 'weekday');
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
  const weekdaysApply = key !== 'holiday' && key !== 'date';
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
        date: key === 'date' ? date : null,
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
            { value: 'weekday', label: 'Weekdays' },
            { value: 'friday', label: 'Friday' },
            { value: 'weekend', label: 'Weekend' },
            { value: 'holiday', label: 'Holiday' },
            { value: 'date', label: 'One dated day (event)' },
          ]}
          onChange={(v) => setKey(v as DayConfigKey)}
        />
        {weekdaysApply ? <WeekdaysEditor value={weekdays} onChange={setWeekdays} /> : null}
        {key === 'date' ? (
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
            (key === 'date' && !date) ||
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

function HolidaysTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  // The table grows by a year of days per import and never shrinks, so the default view
  // is the year in hand rather than every year ever loaded.
  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(thisYear);
  const [locationFilter, setLocationFilter] = useState('');
  const years = [...new Set(reference.holidays.map((h) => h.date.slice(0, 4)))].sort();
  const sorted = [...reference.holidays]
    .filter((h) => !year || h.date.startsWith(year))
    .filter((h) => !locationFilter || h.locationIds.includes(locationFilter))
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex flex-col gap-3">
      <HolidayImport locations={reference.locations} />
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelectField
          value={year}
          ariaLabel="Filter by year"
          options={[{ value: '', label: 'Every year' }, ...years.map((y) => ({ value: y, label: y }))]}
          onChange={setYear}
        />
        <NativeSelectField
          value={locationFilter}
          ariaLabel="Filter by location"
          options={[{ value: '', label: 'Every location' }, ...reference.locations.map((l) => ({ value: l.id, label: l.name }))]}
          onChange={setLocationFilter}
        />
        <span className="text-[11.5px] text-faint">
          {sorted.length} of {reference.holidays.length}
        </span>
      </div>
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
    </div>
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
          <th title="How far either side of the worked weekend a comp day may be placed">
            Comp-off before / after
          </th>
          <th title="Weekdays a comp day is never placed on">Never on</th>
          <th>Aging threshold</th>
          <th title="No free slot in the window: raise it for approval rather than dropping it">
            Approve when no slot
          </th>
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
            {/* Mon and Fri by default, and stored per unit — but there was no control, so
                the one part of the comp-off search a team actually argues about needed a
                deployment. */}
            <WeekdaysEditor
              value={draft.compOffPolicy.excludedWeekdays}
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, excludedWeekdays: v })}
            />
          </td>
          <td>
            <NumberField
              value={draft.compOffPolicy.agingThresholdDays}
              ariaLabel="Comp-off aging threshold"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, agingThresholdDays: v })}
            />
            <span className="ml-1 text-faint">days</span>
          </td>
          <td>
            <CheckboxField
              checked={draft.compOffPolicy.requiresApprovalWhenNoSlot}
              ariaLabel="Requires approval when no slot"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, requiresApprovalWhenNoSlot: v })}
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
  // The kinds of leave a rule counts by default: whatever an administrator has already
  // said counts against capacity. Hardcoding a list of codes here was how this row came
  // to carry `countsTypes` — a field no layer below it has ever known about.
  const countedByDefault = reference.eventTypes
    .filter((t) => t.isActive && t.countsTowardCapacity)
    .map((t) => t.id);
  const activeEventTypes = [...reference.eventTypes]
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <EditableTable
      title="rule"
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
        countsEventTypeIds: countedByDefault,
        countsCompDays: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Unit</th>
          <th>Scope</th>
          <th>Duration</th>
          <th title="How many workdays of leave make an absence “long”">Long from</th>
          <th>Max concurrent</th>
          <th title="Which kinds of leave this limit counts. A kind nothing counts is unlimited.">
            Counts
          </th>
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
              onChange={(v) => {
                setField('unitId', v);
                // Moving the rule takes its pool with it, and the old unit's shift is not in
                // the new unit — leaving it there is a row the server rejects on save.
                if (draft.scope.kind === 'SHIFT_POOL') {
                  setField('scope', { kind: 'SHIFT_POOL', shiftId: reference.shifts.find((s) => s.unitId === v)?.id ?? '' });
                }
              }}
            />
          </td>
          <td className="flex items-center gap-1">
            <NativeSelectField
              value={draft.scope.kind}
              ariaLabel="Scope"
              options={[{ value: 'UNIT', label: 'Unit-wide' }, { value: 'SHIFT_POOL', label: 'Shift pool' }]}
              onChange={(v) =>
                setField(
                  'scope',
                  v === 'SHIFT_POOL'
                    ? // The pool has to belong to the rule's own unit. This used to reach for
                      // `shifts[0]`, which is whatever unit happens to sort first — a rule
                      // limiting an EMEA pool from an APAC row, rejected only by the server.
                      { kind: 'SHIFT_POOL', shiftId: reference.shifts.find((s) => s.unitId === draft.unitId)?.id ?? '' }
                    : { kind: 'UNIT' },
                )
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
            {/* The boundary between the two buckets. It was stored, used by the engine and
                editable nowhere, so "3 long / 4 short" was a rule whose "long" nobody could
                read off the screen. */}
            <NumberField
              min={0}
              value={draft.longThresholdWorkdays}
              ariaLabel="Long from, workdays"
              onChange={(v) => setField('longThresholdWorkdays', v)}
            />
            <span className="ml-1 text-faint">workdays</span>
            <FieldErrorList errors={errors?.longThresholdWorkdays} />
          </td>
          <td>
            <NumberField min={0} value={draft.maxConcurrent} ariaLabel="Max concurrent" onChange={(v) => setField('maxConcurrent', v)} />
            <FieldErrorList errors={errors?.maxConcurrent} />
          </td>
          <td className="flex max-w-[260px] flex-wrap gap-x-2 gap-y-0.5">
            {activeEventTypes.map((type) => (
              <label key={type.id} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.countsEventTypeIds.includes(type.id)}
                  onChange={(e) =>
                    setField(
                      'countsEventTypeIds',
                      e.target.checked
                        ? [...draft.countsEventTypeIds, type.id]
                        : draft.countsEventTypeIds.filter((id) => id !== type.id),
                    )
                  }
                />
                {type.shortLabel || type.label}
              </label>
            ))}
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
  // ~80 rows in one flat table: finding one person meant Ctrl+F, and Ctrl+F does not
  // reach a `<select>`'s current value.
  const [query, setQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const rows: AdminPersonSummary[] = reference.people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    initials: p.initials,
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.email ? { email: p.email } : {}),
    unitId: p.unitId,
    locationId: p.locationId,
    orgCategory: p.orgCategory,
    isActive: p.isActive,
    isIncluded: p.isIncluded,
  }));

  const needle = query.trim().toLowerCase();
  const visible = rows
    .filter((r) => !unitFilter || r.unitId === unitFilter)
    .filter((r) => !activeOnly || r.isActive)
    .filter(
      (r) =>
        !needle ||
        r.displayName.toLowerCase().includes(needle) ||
        (r.email ?? '').toLowerCase().includes(needle) ||
        (r.employeeId ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="field w-56 py-0.5"
          value={query}
          placeholder="Name, email or employee ID"
          aria-label="Search people"
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelectField
          value={unitFilter}
          ariaLabel="Filter by unit"
          options={[{ value: '', label: 'Every unit' }, ...reference.units.map((u) => ({ value: u.id, label: u.name }))]}
          onChange={setUnitFilter}
        />
        <label className="flex items-center gap-1.5 text-[11.5px]">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <span className="text-[11.5px] text-faint">
          {visible.length} of {rows.length}
        </span>
      </div>
      <EditableTable
      title="person"
      rows={visible}
      entity="person"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        displayName: '',
        initials: '',
        employeeId: '',
        email: '',
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
          <th>Employee ID</th>
          <th>Email (sign-in)</th>
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
            {/* External key an HR import will eventually match people by
                (already tried first, client-side, by AbsenceImportDialog's
                matchPeople) — unique once set, enforced server-side. */}
            <TextField
              mono
              value={draft.employeeId ?? ''}
              ariaLabel="Employee ID"
              onChange={(v) => setField('employeeId', v)}
            />
            <FieldErrorList errors={errors?.employeeId} />
          </td>
          <td>
            {/* What an Entra ID sign-in resolves to this person by (ADR-0058). Blank
                means they cannot sign in — the token's email matches nobody and the API
                answers 403 PRINCIPAL_NOT_MAPPED, naming the address to link. */}
            <TextField
              mono
              value={draft.email ?? ''}
              ariaLabel="Email (sign-in)"
              onChange={(v) => setField('email', v)}
            />
            <FieldErrorList errors={errors?.email} />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display — display timezone, moved off the header's clock strip
// ---------------------------------------------------------------------------

/**
 * Display timezone moved off a click on the header's location clocks
 * (`AppShell.tsx`'s `LocationClockStrip`, now a read-only indicator) — that
 * changed exactly two tooltip strings on Overview and nothing else, which
 * read as broken rather than as a working control.
 */
// DisplayTab moved to the profile menu (features/shell/DisplayMenu.tsx): Settings is
// admin-only now, and which timezone you read the grid in is everybody’s preference.

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
    /** Two fields that are only valid together — see `useAdminEdits.setFields`. */
    setFields: (patch: Record<string, unknown>) => void,
  ) => ReactElement;
}) {
  // The pending row as typed so far. It used to render from `newInitial` — a fresh object
  // literal every render — so every keystroke in a new row was written to `pending` and
  // then immediately painted back over with the initial value: a controlled input nobody
  // could type into, on every tab's "+ New" row.
  const creatingDraft = edits.pendingCreates.find((c) => c.entity === entity && c.tempId === newTempId)?.patch;
  const creating = creatingDraft !== undefined;

  return (
    <table className="rows">
      <thead>{renderHeader()}</thead>
      <tbody>
        {rows.length === 0 && !creatingDraft ? (
          <tr>
            <td colSpan={20} className="text-[12px] text-faint">
              Nothing here yet — “+ New {title}” below.
            </td>
          </tr>
        ) : null}
        {rows.map((row) => {
          const draft = edits.draftOf(entity, row.id, row as unknown as Record<string, unknown>) as unknown as T;
          const markedForDelete = edits.isMarkedForDelete(entity, row.id);
          const errors = edits.fieldErrorsFor(entity, row.id);
          // `isDirty` existed and was called by nothing: an edited row looked exactly like
          // an untouched one, so "5 unsaved changes" was a number with no rows attached.
          const dirty = edits.isDirty(entity, row.id);
          return (
            <tr
              key={row.id}
              className={markedForDelete ? 'opacity-40' : undefined}
              data-dirty={dirty && !markedForDelete ? true : undefined}
              data-rejected={errors ? true : undefined}
            >
              {renderRow(
                draft,
                (field, value) => edits.setField(entity, row.id, field, value, draft as unknown as Record<string, unknown>),
                errors,
                (patch) => edits.setFields(entity, row.id, patch, draft as unknown as Record<string, unknown>),
              )}
              <td>
                {markedForDelete ? (
                  <button type="button" className="btn btn--sm" onClick={() => edits.discardOne(entity, row.id)}>
                    Undo delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost text-bad"
                    title={`Mark this ${title} for deletion — applied on Save all, undoable until then`}
                    onClick={() => edits.markDelete(entity, row.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          );
        })}

        {creatingDraft ? (
          <tr>
            {renderRow(
              creatingDraft as unknown as T,
              (field, value) => edits.setCreateField(entity, newTempId, field, value),
              edits.fieldErrorsFor(entity, `new:${newTempId}`),
              (patch) => edits.setFields(entity, `new:${newTempId}`, patch, creatingDraft),
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

/**
 * Who may plan, approve and administer, and where (ADR-0051).
 *
 * WHY a matrix of people against roles rather than a list of grants: the question people
 * actually arrive with is "who approves EMEA's leave", and a flat list of rows sorted by
 * whatever the database returned does not answer it. The unit filter comes first because
 * a grant means nothing without it.
 *
 * Viewer is absent on purpose: everyone signed in has it, and a checkbox that can only
 * ever be ticked is a lie about what is configurable.
 */
function RolesTab({ reference }: { readonly reference: Reference }) {
  const [scope, setScope] = useState<string>(reference.units[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [grantedOnly, setGrantedOnly] = useState(false);
  const caps = useCapabilities();
  const grants = useRoleAssignments();
  const grant = useGrantRole();
  const revoke = useRevokeRole();

  const unitId = scope === GLOBAL_SCOPE ? null : scope;
  const mayEdit = unitId === null ? caps.canAdministerGlobally : caps.canAdminister(unitId);

  const held = new Map<string, string>();
  for (const row of grants.data ?? []) {
    if ((row.unitId ?? null) === unitId) held.set(`${row.personId}|${row.role}`, row.id);
  }

  // "Who approves EMEA's leave" over eighty rows of mostly-empty checkboxes was a scroll,
  // not an answer.
  const needle = query.trim().toLowerCase();
  const rows = [...reference.people]
    .filter((person) => person.isActive)
    .filter((person) => !needle || person.displayName.toLowerCase().includes(needle))
    .filter((person) => !grantedOnly || GRANTABLE.some((role) => held.has(`${person.id}|${role.toLowerCase()}`)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // A grant is one immediate write, unlike every other tab's Save All — so a failure has
  // to say so itself. It used to fail silently and leave the box looking ticked.
  const toggle = (personId: string, role: Lowercase<AppRole>) => {
    const existing = held.get(`${personId}|${role}`);
    const onError = (err: unknown) =>
      toast.bad(err instanceof ApiError ? err.message : 'The grant could not be changed.');
    if (existing) revoke.mutate(existing, { onError });
    else grant.mutate({ personId, unitId, role }, { onError });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">Grants in</span>
        <div className="segmented">
          {reference.units.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className="segmented__item"
              data-active={scope === unit.id}
              onClick={() => setScope(unit.id)}
            >
              {unit.name}
            </button>
          ))}
          <button
            type="button"
            className="segmented__item"
            data-active={scope === GLOBAL_SCOPE}
            onClick={() => setScope(GLOBAL_SCOPE)}
            title="Roles that apply in every unit, and configuration that belongs to none"
          >
            Every unit
          </button>
        </div>
        <input
          type="search"
          className="field w-48 py-0.5"
          value={query}
          placeholder="Find a person"
          aria-label="Find a person"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-[11.5px]">
          <input type="checkbox" checked={grantedOnly} onChange={(e) => setGrantedOnly(e.target.checked)} />
          Only people with a grant here
        </label>
      </div>

      {mayEdit ? null : (
        <p className="text-[12px] text-warn">
          {unitId === null
            ? 'Only a global administrator can grant a role in every unit.'
            : 'You do not administer this unit, so these grants are read-only for you.'}
        </p>
      )}

      <table className="rows">
        <thead>
          <tr>
            <th className="text-left">Person</th>
            {GRANTABLE.map((role) => (
              <th key={role} className="w-[110px] text-left">
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => (
            <tr key={person.id}>
              <td>
                <span className="font-medium">{person.displayName}</span>
                <span className="ml-2 text-[11px] text-faint">{person.unitId}</span>
              </td>
              {GRANTABLE.map((role) => {
                const key = role.toLowerCase() as Lowercase<AppRole>;
                const on = held.has(`${person.id}|${key}`);
                return (
                  <td key={role}>
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!mayEdit}
                        onChange={() => toggle(person.id, key)}
                        aria-label={`${role} for ${person.displayName}`}
                      />
                      <span className="text-faint">{on ? 'yes' : '—'}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The two operations that replaced `Seed:IncludeDemoData`, `--seed-demo` and
 * `Auth:BootstrapAdminEmail` (ADR-0059): loading the demo fixture into an untouched Bare
 * system, and resetting to the migrated-but-empty state the setup wizard runs against.
 * Global-Admin only — configuration belonging to no unit is a global grant's business.
 */
function MaintenanceTab() {
  const caps = useCapabilities();
  const canLoad = useCanLoadDemoData();
  const loadDemo = useLoadDemoData();
  const reset = useResetSystem();
  const [confirmText, setConfirmText] = useState('');

  if (!caps.canAdministerGlobally) {
    return (
      <p className="p-4 text-[12px] text-warn">
        Maintenance means the same thing for the whole system, so it needs a global
        administrator. This is read-only for you.
      </p>
    );
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Load demo data</h3>
        <p className="text-[12px] text-muted">
          Replaces this system's single location, unit and administrator with the fixture
          entire: four planning units, a trimmed roster, shifts and a sample rota. Only
          offered while nobody has added a person or scheduled anything yet — merging the
          fixture's fixed ids into a system somebody has already typed real data into
          would produce a roster nobody can reason about.
        </p>
        <button
          type="button"
          className="btn btn--sm self-start"
          disabled={!canLoad.data?.available || loadDemo.isPending}
          onClick={() =>
            loadDemo.mutate(undefined, {
              onSuccess: () => toast.ok('Demo data loaded.'),
              onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Could not load demo data.'),
            })
          }
        >
          {loadDemo.isPending ? 'Loading…' : 'Load demo data'}
        </button>
        {canLoad.data && !canLoad.data.available ? (
          <p className="text-[11.5px] text-faint">
            Unavailable: this system already has people, a rota, or time off recorded.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        <h3 className="text-base font-semibold text-bad">Reset to empty</h3>
        <p className="text-[12px] text-muted">
          Deletes every location, unit, person, shift, absence, comp day and role grant,
          and returns to the migrated-but-empty state — the next visit shows the setup
          wizard again. This does not drop the database; nothing entered by hand survives
          it.
        </p>
        <label className="flex flex-col gap-1 text-[11.5px] text-faint">
          Type RESET to confirm
          <input
            type="text"
            className="field w-40 py-0.5 font-mono text-[12px]"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Type RESET to confirm"
          />
        </label>
        <button
          type="button"
          className="btn btn--sm btn--danger self-start"
          disabled={confirmText !== 'RESET' || reset.isPending}
          onClick={() =>
            reset.mutate(undefined, {
              onSuccess: () => setConfirmText(''),
              onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Reset failed.'),
            })
          }
        >
          {reset.isPending ? 'Resetting…' : 'Reset to empty'}
        </button>
      </section>
    </div>
  );
}

/** Sentinel for the "every unit" tab; a real unit id can never be empty. */
const GLOBAL_SCOPE = '';

/** Viewer is what everyone signed in already holds, so it is not grantable. */
const GRANTABLE = APP_ROLES.filter((role) => role !== 'Viewer');

/**
 * Kinds of non-working day (ADR-0049).
 *
 * The colour is the one that fills the cell, and the short label is what a 62px column
 * shows — both are here because both are matters of taste that changed twice in review and
 * should not need a deployment to change a third time.
 *
 * There is **no delete**: absences point at these by id, so a retired kind is unticked
 * rather than removed and keeps its name for the rows that already use it.
 */
function EventTypesTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const sorted = [...reference.eventTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <GlobalAdminNotice reference={reference} what="Kinds of leave" />

      <EditableTable
        title="leave type"
        rows={sorted}
        entity="eventType"
        edits={edits}
        newTempId={tempId}
        newInitial={{
          code: '',
          label: '',
          shortLabel: '',
          color: '#9aa3ad',
          category: 'OTHER',
          blocksAssignment: true,
          countsTowardCapacity: true,
          requiresApproval: true,
          allowsHalfDay: true,
          isActive: true,
          sortOrder: sorted.length + 1,
        }}
        renderHeader={() => (
          <tr>
            <th>Label</th>
            <th className="w-[130px]" title="The stable key imports and the seed match on. Fixed once created.">
              Code
            </th>
            <th className="w-[90px]">In the cell</th>
            <th className="w-[70px]">Colour</th>
            <th className="w-[120px]">Category</th>
            <th className="w-[80px]" title="Closes the day out — a shift on it is flagged as a conflict">
              Blocks
            </th>
            <th className="w-[90px]" title="Counted against the simultaneous-absence limit">
              Capacity
            </th>
            <th className="w-[90px]" title="Has to be requested and approved, by anybody — planners included">
              Approval
            </th>
            <th className="w-[80px]">Half day</th>
            <th className="w-[70px]" title="Unticking retires it; existing absences keep their name">
              Active
            </th>
            <th className="w-[70px]" title="Where it sits in the cell menu — Presence has the same column">
              Order
            </th>
            <th />
          </tr>
        )}
        renderRow={(draft: EventType, setField, errors) => (
          <>
            <td>
              <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
              <FieldErrorList errors={errors?.label} />
            </td>
            <td>
              {/* Required by the server and rendered by nothing, so "+ New leave type" was a
                  row that could only ever come back 400 with the offending field off-screen.
                  Fixed after creation: it is the key absences and the seed match on, and the
                  update path does not check a changed one for collisions. */}
              {draft.id ? (
                <span className="font-mono text-[11.5px] text-faint">{draft.code}</span>
              ) : (
                <>
                  <TextField mono value={draft.code} ariaLabel="Code" placeholder="SABBATICAL" onChange={(v) => setField('code', v)} />
                  <FieldErrorList errors={errors?.code} />
                </>
              )}
            </td>
            <td>
              <TextField
                value={draft.shortLabel}
                ariaLabel="Short label"
                onChange={(v) => setField('shortLabel', v)}
              />
              <FieldErrorList errors={errors?.shortLabel} />
            </td>
            <td>
              <input
                type="color"
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent"
                value={draft.color}
                aria-label="Colour"
                onChange={(e) => setField('color', e.target.value)}
              />
            </td>
            <td>
              <NativeSelectField
                value={draft.category}
                ariaLabel="Category"
                options={[
                  { value: 'LEAVE', label: 'Leave' },
                  { value: 'SICKNESS', label: 'Sickness' },
                  { value: 'OTHER', label: 'Other' },
                ]}
                onChange={(v) => setField('category', v)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.blocksAssignment}
                aria-label="Blocks assignment"
                onChange={(e) => setField('blocksAssignment', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.countsTowardCapacity}
                aria-label="Counts toward capacity"
                onChange={(e) => setField('countsTowardCapacity', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.requiresApproval}
                aria-label="Requires approval"
                onChange={(e) => setField('requiresApproval', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.allowsHalfDay}
                aria-label="Allows half day"
                onChange={(e) => setField('allowsHalfDay', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.isActive}
                aria-label="Active"
                onChange={(e) => setField('isActive', e.target.checked)}
              />
            </td>
            <td>
              <NumberField value={draft.sortOrder} ariaLabel="Sort order" onChange={(v) => setField('sortOrder', v)} />
            </td>
          </>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presence types
// ---------------------------------------------------------------------------

/**
 * The "where are you working" options (ADR-0043) — what they are called, how they are
 * drawn, and whether recording one raises a request instead of writing the day.
 *
 * WHY this is not an `EditableTable`: there is no New and no Delete. One row per
 * `PresenceKind`, and the kind is what every record carries, so a fifth row from a screen
 * would be a value nothing downstream understands. Retiring one is Active off, which drops
 * it from the cell menu while existing records keep their colour and their name.
 *
 * The approval column is the one that earns the screen. "Remote needs signing off" used to
 * be an `if` in the cell menu; it is a local policy, and a team that trusts remote days —
 * or one that wants travel signed off — should not need a release.
 */
function PresenceTypesTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const sorted = [...reference.presenceTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">
        The options on a cell&rsquo;s right-click menu. Presence never affects coverage
        &mdash; somebody remote on <code>Crew</code> still covers <code>Crew</code>.
      </p>
      <GlobalAdminNotice reference={reference} what="Where people work" />

      <EditableTable
        title="way of working"
        rows={sorted}
        entity="presenceType"
        edits={edits}
        newTempId={tempId}
        newInitial={{
          label: '',
          glyph: '',
          color: '#6b7688',
          namesALocation: false,
          countsAs: 'AWAY',
          requiresApproval: false,
          isActive: true,
          sortOrder: sorted.length + 1,
        }}
        renderHeader={() => (
          <tr>
            <th>Label</th>
            <th className="w-[80px]" title="One or two characters — the presence band in a cell is 9px">
              In the cell
            </th>
            <th className="w-[70px]">Colour</th>
            <th className="w-[110px]" title="Recording it picks one of our offices, instead of free text">
              An office
            </th>
            <th className="w-[130px]" title="Which headcount it adds to on the coverage strip">
              Counts as
            </th>
            <th className="w-[100px]" title="Has to be asked for and approved, by anybody — planners included">
              Approval
            </th>
            <th className="w-[70px]" title="Unticking hides it from the menu; existing records keep it">
              Offered
            </th>
            <th className="w-[70px]">Order</th>
            <th />
          </tr>
        )}
        renderRow={(draft: PresenceType, setField, errors) => (
          <>
            <td>
              <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
              <FieldErrorList errors={errors?.label} />
            </td>
            <td>
              <TextField value={draft.glyph} ariaLabel="Glyph" onChange={(v) => setField('glyph', v)} />
              <FieldErrorList errors={errors?.glyph} />
            </td>
            <td>
              <input
                type="color"
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent"
                value={draft.color}
                aria-label="Colour"
                onChange={(e) => setField('color', e.target.value)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.namesALocation}
                aria-label="Names an office"
                onChange={(e) => setField('namesALocation', e.target.checked)}
              />
            </td>
            <td>
              <NativeSelectField
                value={draft.countsAs}
                ariaLabel="Counts as"
                options={[
                  { value: 'ON_SITE', label: 'On site' },
                  { value: 'REMOTE', label: 'Remote' },
                  { value: 'AWAY', label: 'Away' },
                ]}
                onChange={(v) => setField('countsAs', v)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.requiresApproval}
                aria-label="Requires approval"
                onChange={(e) => setField('requiresApproval', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.isActive}
                aria-label="Offered"
                onChange={(e) => setField('isActive', e.target.checked)}
              />
            </td>
            <td>
              <NumberField
                value={draft.sortOrder}
                ariaLabel="Sort order"
                onChange={(v) => setField('sortOrder', v)}
              />
            </td>
          </>
        )}
      />
    </div>
  );
}

/**
 * "This is read-only for you" — and **who to ask**.
 *
 * WHY the names: the previous version stated the rule and stopped there, so the reader
 * was told a global administrator exists and given no way to find one. There is nothing
 * else in the product that answers it either; the seed creates exactly one, and hunting
 * for them meant acting as people one at a time in the dev switcher.
 *
 * Reading grants needs no privilege on purpose — "who approves my leave" and "who can
 * change this" are fair questions for the person waiting on the answer.
 */
function GlobalAdminNotice({ reference, what }: { readonly reference: Reference; readonly what: string }) {
  const caps = useCapabilities();
  const grants = useRoleAssignments();
  if (caps.canAdministerGlobally) return null;

  const names = (grants.data ?? [])
    .filter((g) => g.role.toLowerCase() === 'admin' && !g.unitId)
    .map((g) => reference.people.find((p) => p.id === g.personId)?.displayName ?? g.personId);

  return (
    <p className="text-[12px] text-warn">
      {what} means the same thing in every unit, so changing it needs a global
      administrator. This is read-only for you.{' '}
      {names.length > 0
        ? `Ask ${[...new Set(names)].join(', ')}.`
        : 'Nobody holds that grant — a global admin has to be granted on the Roles tab first.'}
    </p>
  );
}

/** "1 row" / "2 rows" — a count with the wrong plural beside it reads as a bug. */
function rowWord(count: number): string {
  return count === 1 ? 'row' : 'rows';
}
