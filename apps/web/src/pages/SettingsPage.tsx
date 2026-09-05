/**
 * Settings — the shell: which tabs exist, which one is open, and the dirty bar
 * that saves them.
 *
 * Each tab is its own module in `features/settings/`. This file used to hold
 * all twelve inline and ran to 2 300 lines, which made every settings change a
 * conflict with every other one.
 *
 * Two rules the tabs share, kept here because they are about the screen rather
 * than any one entity:
 *
 * - Colors, labels and display names are edited in place, like any other
 *   unversioned attribute (CLAUDE.md point 14). Day configurations are the one
 *   exception: `resolveDayConfiguration`/`DayConfigurationResolver` already pick
 *   the latest applicable `effectiveFrom`, so the only edit action offered for
 *   them is "create a new version" — the history stays visible below it, never
 *   overwritten (ADR-0021).
 * - Nothing here hits the network per keystroke. Every tab reads its rows
 *   through `draftOf` (`useAdminEdits`), which overlays any pending edit on top
 *   of the server value; the dirty bar's Save All is what calls the mutations,
 *   all at once, and Cancel just clears the pending map.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { adminAbsenceCapacityRules, adminHolidays, adminLocations, adminEventTypes, adminPresenceTypes, adminPeople, usePeopleBatch, PeopleBatchError, type PersonAdminRequest, adminShifts, adminUnits, absenceCapacityRuleToWire, eventTypeToWire, presenceTypeToWire, holidayToWire, locationToWire, personAdminToWire, shiftToWire, unitToWire } from '../api/admin.ts';
import { BatchRejected, type AdminEntity, type EntityOps, useAdminEdits } from '../features/settings/useAdminEdits.ts';
import { rowWord } from '../features/settings/shared.tsx';
import { DirtyBar } from '../features/settings/DirtyBar.tsx';
import { useUi } from '../store/useUi.ts';
import { useCapabilities } from '../auth/useCapabilities.ts';
import { useReferenceQuery } from '../api/queries.ts';
import { toast } from '../ui/toasts.ts';
import { AbsenceLimitsTab } from '../features/settings/AbsenceLimitsTab.tsx';
import { DayConfigurationsTab } from '../features/settings/DayConfigurationsTab.tsx';
import { EventTypesTab } from '../features/settings/EventTypesTab.tsx';
import { HolidaysTab } from '../features/settings/HolidaysTab.tsx';
import { LocationsTab } from '../features/settings/LocationsTab.tsx';
import { MaintenanceTab } from '../features/settings/MaintenanceTab.tsx';
import { NotificationsTab } from '../features/settings/NotificationsTab.tsx';
import { PeopleTab } from '../features/settings/PeopleTab.tsx';
import { PresenceTypesTab } from '../features/settings/PresenceTypesTab.tsx';
import { RolesTab } from '../features/settings/RolesTab.tsx';
import { ShiftsTab } from '../features/settings/ShiftsTab.tsx';
import { UnitsTab } from '../features/settings/UnitsTab.tsx';
import { useReference } from '../store/useDataset.ts';

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

export function SettingsPage() {
  const [tab, setTab] = useTabInUrl();
  const caps = useCapabilities();
  const reference = useReference();
  // Keeps the `reference` query an active TanStack Query observer for as long as Settings
  // is open. Without an observer, `invalidateQueries({ queryKey: referenceQueryKey })` —
  // every admin mutation, `api/admin.ts` — only marks the cache stale; it does not
  // actually refetch, so a deleted row stayed in `useSchedule.reference` (and on screen)
  // until a full page reload. The value itself is unused here: `useSchedule`'s own cache
  // subscription (`store/useSchedule.ts`) is what writes a successful refetch back into
  // the store, the same way it already does for the schedule query.
  useReferenceQuery();
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

  // Settings is a data-editing surface, not a document — the widest tables (Units, Shifts)
  // need ~1420px once every column has a real field in it, and 1200px clipped them, so
  // "Save all" required scrolling sideways to see what you had just edited. Wide but
  // bounded, not full-bleed like the planning grid (ADR-0057): a 1200px table stretched to
  // a 2560px monitor would look stranded, not intentional.
  return (
    <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 p-4">
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
