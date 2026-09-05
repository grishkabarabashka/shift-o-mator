/**
 * The self-service half of the cell menu: where I'm working, and time off.
 *
 * WHY it is a list of one-click items rather than two entries that open dialogs: saying
 * "I'm remote on Tuesday" is a two-second thought, and routing it through a modal with a
 * type picker and a date range it already knows made it a chore. The common cases are
 * direct; the dialog survives for the rest.
 *
 * The portion toggle is the same idea. It costs nothing when you want a whole day, which
 * is nearly always, and one click when you do not.
 */

import { useState } from 'react';
import { useCreateRequest, useRequestTypes } from '../../api/requests.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import type { DayPortion, EventType, Location, PresenceType } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import type { CellRef } from '../../store/useSchedule.ts';
import { useReference } from '../../store/useDataset.ts';

/** How many absence types get their own item before the rest go behind "More…". */
const DIRECT_TYPE_LIMIT = 3;

const PORTIONS: readonly { value: DayPortion; label: string }[] = [
  { value: 'FULL', label: 'Day' },
  { value: 'MORNING', label: 'AM' },
  { value: 'AFTERNOON', label: 'PM' },
];

export function CellSelfServiceMenu({
  cells,
  subjectPersonId,
  subjectUnitId,
  closedOut,
  locations,
  presenceIds,
  onMore,
  onDone,
}: {
  readonly cells: readonly CellRef[];
  readonly subjectPersonId: string;
  /** The subject's planning unit — every permission question is scoped to it. */
  readonly subjectUnitId: string | undefined;
  /** The day is already closed out by leave, so presence has nothing to say about it. */
  readonly closedOut: boolean;
  readonly locations: readonly Location[];
  /** Recorded presence over the selected cells — what "clear" would remove. */
  readonly presenceIds: readonly string[];
  /** Opens the full dialog, for a type that is not on the short list. */
  readonly onMore: () => void;
  readonly onDone: () => void;
}) {
  const savePresence = useSchedule((s) => s.savePresence);
  const removePresence = useSchedule((s) => s.removePresence);
  const saveAbsence = useSchedule((s) => s.saveAbsence);
  const eventTypes = useReference()?.eventTypes ?? [];
  const presenceTypes = useReference()?.presenceTypes ?? [];
  const people = useReference()?.people ?? [];
  const requestTypes = useRequestTypes();
  const selfId = useSchedule((s) => s.currentUserId);
  const caps = useCapabilities();
  const createRequest = useCreateRequest();

  const [portion, setPortion] = useState<DayPortion>('FULL');
  const [showOffices, setShowOffices] = useState(false);

  // One range per person, from the selection's outermost columns — the same shape the
  // dialogs build.
  const ranges = rangesOf(cells);

  const subject = people.find((p) => p.id === subjectPersonId);
  const baselineSite = subject?.defaultSiteLocationId;

  // WHY the labels move: "Where I'm working" over somebody else's row is a lie, and it was
  // the reason a planner expected the request to be about them.
  const aboutSelf = subjectPersonId === selfId;
  const firstName = subject?.displayName.split(' ')[0] ?? 'them';

  // Recording somebody else's presence directly is a planner's act, in their unit; the
  // menu only offers what the server would accept.
  const canRecordForSubject = subjectPersonId === selfId || caps.canPlan(subjectUnitId);

  const recordPresence = (typeId: string, siteLocationId?: string) => {
    if (!canRecordForSubject) return;
    for (const range of ranges) {
      void savePresence({
        personId: range.personId,
        typeId,
        from: range.from,
        to: range.to,
        portion,
        ...(siteLocationId ? { siteLocationId } : {}),
      });
    }
    onDone();
  };

  const raiseWith = (type: { readonly id: string } | undefined) => {
    if (!type) return;
    for (const range of ranges) {
      createRequest.mutate({
        typeId: type.id,
        // WHY explicit: without it the server files the request against the caller, so a
        // planner asking on somebody else's row got leave for themselves.
        subjectPersonId: range.personId,
        from: range.from,
        to: range.to,
        portion,
      });
    }
    onDone();
  };

  const raise = (typeCode: string) =>
    raiseWith(requestTypes.data?.find((t) => t.code === typeCode));

  const recordAbsence = (eventType: EventType) => {
    // Direct writes, one row each (ADR-0052). No draft is involved: a draft publishes the
    // rota, and this is not part of that decision.
    void (async () => {
      for (const range of ranges) {
        await saveAbsence({
          personId: range.personId,
          eventTypeId: eventType.id,
          portion,
          from: range.from,
          to: range.to,
        });
      }
    })();
    onDone();
  };

  /**
   * Whether it needs approving is the presence type's own answer, not a rule about which
   * kind it is (ADR-0043, following ADR-0051). Remote is the seeded example because it is
   * the one the business asks about — but that is a row an admin flips, so the check has
   * to read the row. The server enforces the same thing, so this is the menu agreeing with
   * it rather than the menu deciding it.
   */
  const takePresence = (type: PresenceType, siteLocationId?: string) => {
    if (type.requiresApproval) {
      raiseWith(requestTypes.data?.find((rt) => rt.presenceTypeId === type.id));
    } else {
      recordPresence(type.id, siteLocationId);
    }
  };

  /**
   * Whether it needs approving is a property of the **thing**, not of who is asking
   * (ADR-0051). A planner putting leave on somebody's row raises a request like anybody
   * else — the planner owns the rota, not other people's time off.
   */
  const takeAbsence = (eventType: EventType) => {
    if (eventType.requiresApproval) raise(eventType.code);
    else recordAbsence(eventType);
  };

  const offices = locations.filter((l) => l.id !== baselineSite);
  // Retired kinds still render on existing records; they are just not offered.
  const presenceOptions = presenceTypes
    .filter((type) => type.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // Only a type that names one of our offices has a sublist of them. There can be more
  // than one now that the set is open; the first is the one the sublist belongs to.
  const officeType = presenceOptions.find((type) => type.namesALocation);
  const active = eventTypes
    .filter((t) => portion === 'FULL' || t.allowsHalfDay)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <div className="menu-sep" />
      <div className="menu-portion" role="group" aria-label="How much of the day">
        {PORTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="menu-portion__button"
            data-active={portion === option.value || undefined}
            aria-pressed={portion === option.value}
            onClick={() => setPortion(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* A day could be overwritten but never taken back, which made a mis-click on a
          Saturday permanent. The shifts on the same cell have always had a Clear; this is
          the same thing for the other half of the row. Not offered when there is nothing
          recorded, so the menu never lists an action with no effect. */}
      {presenceIds.length > 0 && canRecordForSubject ? (
        <button
          type="button"
          className="menu-item menu-item--danger"
          role="menuitem"
          onClick={() => {
            void (async () => {
              for (const id of presenceIds) await removePresence(id);
            })();
            onDone();
          }}
        >
          Clear {presenceIds.length > 1 ? `${presenceIds.length} recorded days` : 'what is recorded'}
        </button>
      ) : null}

      {/* Suppressed on a day already closed out by leave: "working from home" while on
          vacation is not a thing you record, and offering it made the menu look like it
          had not noticed what the day already said. The time-off section stays — picking a
          different kind is how you change one (ADR-0052). */}
      {closedOut ? null : (
      <>
      <div className="menu-label">{aboutSelf ? 'Where I’m working' : `Where ${firstName} works`}</div>
      {presenceOptions.map((type) => (
        <PresenceItem
          key={type.id}
          type={type}
          onPick={() => takePresence(type, type.namesALocation ? baselineSite : undefined)}
        />
      ))}

      {/* Only the office kind names a place, so only it has a sublist. */}
      {offices.length > 0 && officeType ? (
        <>
          <button
            type="button"
            className="menu-item text-faint"
            aria-expanded={showOffices}
            onClick={() => setShowOffices(!showOffices)}
          >
            <span aria-hidden className="text-[8px]">
              {showOffices ? '▼' : '▶'}
            </span>
            <span className="text-[11.5px]">Another office ({offices.length})</span>
          </button>
          {showOffices
            ? offices.map((office) => (
                <button
                  key={office.id}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => takePresence(officeType, office.id)}
                >
                  <span className="pl-4">{office.name}</span>
                </button>
              ))
            : null}
        </>
      ) : null}
      </>
      )}

      <div className="menu-sep" />
      <div className="menu-label">
        {closedOut
          ? aboutSelf
            ? 'Change to'
            : `Change ${firstName}’s time off to`
          : aboutSelf
            ? 'Time off'
            : `Time off for ${firstName}`}
      </div>
      {active.slice(0, DIRECT_TYPE_LIMIT).map((eventType) => (
        <button
          key={eventType.id}
          type="button"
          className="menu-item"
          role="menuitem"
          onClick={() => takeAbsence(eventType)}
        >
          <span
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 rounded-[4px]"
            style={{ background: eventType.color }}
          />
          {eventType.label}
          {eventType.requiresApproval ? (
            <span className="ml-auto text-[10px] text-faint">needs approval</span>
          ) : null}
        </button>
      ))}
      {active.length > DIRECT_TYPE_LIMIT ? (
        <button type="button" className="menu-item text-faint" role="menuitem" onClick={onMore}>
          <span className="text-[11.5px]">More kinds of absence…</span>
        </button>
      ) : null}
    </>
  );
}

/** One row in the "where I'm working" list — colour swatch, label, and whether it will
 * be asked for rather than written. Same shape as a time-off row on purpose: they are the
 * same gesture with a different subject. */
function PresenceItem({ type, onPick }: { readonly type: PresenceType; readonly onPick: () => void }) {
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={onPick}>
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-[4px]"
        style={{ background: type.color }}
      />
      {type.label}
      {type.requiresApproval ? (
        <span className="ml-auto text-[10px] text-faint">needs approval</span>
      ) : null}
    </button>
  );
}

/** One inclusive range per person, from the selection's outermost dates. */
function rangesOf(
  cells: readonly CellRef[],
): { personId: string; from: string; to: string }[] {
  const byPerson = new Map<string, string[]>();
  for (const cell of cells) {
    const dates = byPerson.get(cell.personId);
    if (dates) dates.push(cell.date);
    else byPerson.set(cell.personId, [cell.date]);
  }

  return [...byPerson.entries()].map(([personId, dates]) => {
    const sorted = [...dates].sort();
    return { personId, from: sorted[0]!, to: sorted[sorted.length - 1]! };
  });
}
