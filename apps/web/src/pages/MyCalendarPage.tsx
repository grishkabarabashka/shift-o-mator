/**
 * My calendar — one person's own months, scrolled like a calendar.
 *
 * WHY it exists beside the grid: an engineer who wants a day off in November has to reach
 * their own row in a horizontal sheet of twenty-seven people and then reach November. That
 * is a planner's instrument shown to somebody who is not planning. Here a day is a box
 * with room for a real label, months run downwards, and the window grows as you scroll —
 * booking next summer is a normal thing to want and needs no navigation at all.
 *
 * WHY it reuses the grid's projections rather than reading the rows itself: `projectCells`
 * is the precedence chain (shift > absence > comp day > holiday), `projectPresence` and
 * `projectRequests` are the two independent maps beside it. A second answer to "what does
 * this day say" is exactly the duplication those modules exist to prevent — so this screen
 * builds a dataset of one person and runs the same three functions the grid does.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DateTime } from 'luxon';
import { useMyCalendar } from '../api/myCalendar.ts';
import { buildIndex } from '../domain/lookup.ts';
import { cellKey } from '../domain/lookup.ts';
import type { CellValue, IsoDate, PlanData, ScheduleDataset } from '../domain/types.ts';
import { projectCells } from '../engine/cellValue.ts';
import { projectPresence } from '../engine/presence.ts';
import { projectRequests } from '../engine/requests.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { CalendarSidebar } from '../features/calendar/CalendarSidebar.tsx';
import { CalendarMonth, type CalendarDay } from '../features/calendar/CalendarMonth.tsx';
import { CalendarDayMenu } from '../features/calendar/CalendarDayMenu.tsx';
import { useReference } from '../store/useDataset.ts';

/** How many months are on screen to begin with, and how many arrive per extension. */
const INITIAL_AHEAD = 4;
const INITIAL_BEHIND = 1;
const STEP = 3;

/** The server refuses a window longer than this, and a calendar has to stop somewhere. */
const MAX_MONTHS = 24;

export function MyCalendarPage() {
  const reference = useReference();
  const selfId = useSchedule((s) => s.currentUserId);

  const thisMonth = useMemo(() => DateTime.utc().startOf('month'), []);
  const [behind, setBehind] = useState(INITIAL_BEHIND);
  const [ahead, setAhead] = useState(INITIAL_AHEAD);

  const months = useMemo(
    () =>
      Array.from({ length: behind + ahead + 1 }, (_, i) => thisMonth.minus({ months: behind - i })),
    [thisMonth, behind, ahead],
  );

  const range = useMemo(
    () => ({
      from: months[0]!.toISODate() as IsoDate,
      to: months[months.length - 1]!.endOf('month').toISODate() as IsoDate,
    }),
    [months],
  );

  const calendar = useMyCalendar(range);
  const [menu, setMenu] = useState<{ from: IsoDate; to: IsoDate; x: number; y: number }>();

  // --- Projection ------------------------------------------------------------
  //
  // A dataset of one person, so the shared engines can run over it unchanged. The index is
  // rebuilt when the answer changes, which is rarely: a year of one person is a few hundred
  // rows, next to the ~2500 cells the grid indexes on every edit.
  const view = useMemo(() => {
    if (!reference || !calendar.data) return undefined;

    const plan: PlanData = {
      assignments: calendar.data.assignments,
      absences: calendar.data.absences,
      compDays: calendar.data.compDays,
      presence: calendar.data.presence,
      acknowledgements: [],
    };
    const dataset: ScheduleDataset = { ...reference, ...plan, history: [] };
    const index = buildIndex(dataset);

    const projection = projectCells({
      range,
      absences: plan.absences,
      compDays: plan.compDays,
      index,
      eventTypes: new Map(reference.eventTypes.map((t) => [t.id, t])),
    });

    const me = reference.people.find((p) => p.id === calendar.data.personId);
    const presence = projectPresence({
      records: plan.presence,
      dates: eachDateOf(range),
      baselines: me
        ? [
            {
              personId: me.id,
              defaultPresenceTypeId: me.defaultPresenceTypeId,
              defaultSiteLocationId: me.defaultSiteLocationId,
            },
          ]
        : [],
      locations: reference.locations,
      presenceTypes: reference.presenceTypes,
    });

    const requests = projectRequests({
      requests: calendar.data.pendingRequests.map((r) => ({
        id: r.id,
        typeId: r.typeId,
        typeCode: r.typeId,
        typeLabel: r.typeLabel,
        category: 'OTHER' as const,
        subjectPersonId: calendar.data.personId,
        subjectDisplayName: me?.displayName ?? calendar.data.personId,
        from: r.from,
        to: r.to,
        portion: r.portion,
        createdAt: '',
        callerCanDecide: false,
      })),
      dates: eachDateOf(range),
    });

    return { index, projection, presence, requests, personId: calendar.data.personId };
  }, [reference, calendar.data, range]);

  // --- Growing the window ----------------------------------------------------
  //
  // Forward is automatic: a sentinel at the bottom asks for more when it comes into sight.
  // Backwards is a button, and that is a choice rather than an omission — prepending months
  // moves everything already on screen, and compensating the scroll position each time is
  // the kind of thing that jitters on exactly the machines it cannot be tested on.
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    const root = scroller.current;
    if (!node || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setAhead((current) => (behind + current + 1 >= MAX_MONTHS ? current : current + STEP));
      },
      { root, rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [behind]);

  const cellAt = useCallback(
    (date: IsoDate): CellValue =>
      view?.projection.byCell.get(cellKey(view.personId, date)) ?? { kind: 'EMPTY' },
    [view],
  );

  const dayAt = useCallback(
    (date: IsoDate): CalendarDay => {
      const key = view ? cellKey(view.personId, date) : '';
      const value = cellAt(date);
      return {
        date,
        value,
        shift: value.kind === 'SHIFT' ? view?.index.shifts.get(value.shiftId) : undefined,
        nonWorking: view?.projection.nonWorkingByCell.has(key) ?? false,
        presence: view?.presence.byCell.get(key),
        pending: view?.requests.byCell.get(key),
      };
    },
    [view, cellAt],
  );

  if (!reference || !selfId) return null;

  return (
    /* WHY the row is centred and the calendar is measured (ADR-0057): a month stretched to
       a 1920px card gives a day box 230px wide and 76px tall, which is a shape no calendar
       has ever had — the week reads as a row of banners rather than a grid. A month wants
       to be roughly as wide as it is tall. Only the planning grid earns the full width,
       and it earns it by having eighty rows and a horizontal axis. */
    /* Stacks below `lg`: the calendar's own floor is 340px and the sidebar is a fixed 280,
       which together overflow a phone before any gap is counted. Stacked, the sidebar
       becomes what it reads as anyway — a summary above the months. */
    <div className="flex h-full min-h-0 flex-col items-center gap-4 overflow-y-auto p-4 lg:flex-row lg:items-stretch lg:justify-center lg:overflow-hidden">
      <div
        ref={scroller}
        className="card w-[clamp(340px,40vw,560px)] shrink-0 overflow-y-auto shadow-elev-2"
        // The month names stick below this header; `.calendar__title` reads the height from
        // here so the two cannot drift apart.
        style={{ '--calendar-header-h': '62px' } as CSSProperties}
      >
        {/* The one surface this screen exists for, so it is the one that sits on --elev-2. */}
        <header className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold">My calendar</h1>
            {calendar.isFetching ? (
              <span className="ml-auto text-xs text-faint">Loading…</span>
            ) : null}
          </div>
          {/* On its own line rather than trailing the title: as a tail it was a caption on
              the heading, and the one instruction telling somebody how to use this screen
              should not read as a subtitle. */}
          <p className="mt-0.5 text-xs text-muted">
            Right-click a day &mdash; or drag across several &mdash; to ask for time off or
            say where you are working.
          </p>
        </header>

        <div className="flex justify-center border-b border-line py-2">
          <button
            type="button"
            className="btn btn--sm"
            disabled={behind + ahead + 1 >= MAX_MONTHS}
            onClick={() => setBehind((current) => current + STEP)}
          >
            Earlier months
          </button>
        </div>

        <div className="calendar">
          {months.map((month) => (
            <CalendarMonth
              key={month.toISODate()}
              month={month}
              dayAt={dayAt}
              onPick={(from, to, x, y) => setMenu({ from, to, x, y })}
            />
          ))}
        </div>

        <div ref={sentinel} className="h-8" />
        {behind + ahead + 1 >= MAX_MONTHS ? (
          <p className="pb-4 text-center text-[11.5px] text-faint">
            Two years is as far as this goes.
          </p>
        ) : null}
      </div>

      <CalendarSidebar
        compDays={calendar.data?.compDays ?? []}
        pending={calendar.data?.pendingRequests ?? []}
        personId={selfId}
      />

      {menu ? (
        <CalendarDayMenu
          personId={selfId}
          from={menu.from}
          to={menu.to}
          x={menu.x}
          y={menu.y}
          closedOut={isClosedOut(cellAt(menu.from))}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

function isClosedOut(value: CellValue): boolean {
  return value.kind === 'STATUS' && value.status === 'ABSENT';
}

/** NOTE: Local to this screen — `eachDate` lives in the date engine but takes a range and
 * this is the only caller that wants it as an array over a year. */
function eachDateOf(range: { from: IsoDate; to: IsoDate }): IsoDate[] {
  const out: IsoDate[] = [];
  let day = DateTime.fromISO(range.from, { zone: 'utc' });
  const last = DateTime.fromISO(range.to, { zone: 'utc' });
  while (day <= last) {
    out.push(day.toISODate() as IsoDate);
    day = day.plus({ days: 1 });
  }
  return out;
}
