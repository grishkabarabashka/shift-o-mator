/**
 * One month, as a month looks.
 *
 * WHY a day here is 88px rather than 62 and two lines rather than one: this is the screen
 * where somebody reads their own week, not a planner scanning eighty rows. There is room
 * for `Crew 09:00–18:00` and what the day is otherwise about, and using it is the whole
 * point of the screen existing beside the grid.
 *
 * Selection is a drag, because "leave from the 12th to the 19th" is one gesture and two
 * date pickers.
 */

import { useState } from 'react';
import type { DateTime } from 'luxon';
import type { CellValue, IsoDate, Shift } from '../../domain/types.ts';
import type { PresenceMark } from '../../engine/presence.ts';
import type { PendingMark } from '../../engine/requests.ts';
import { STATUS_LABEL } from '../planning/GridCell.tsx';

export interface CalendarDay {
  readonly date: IsoDate;
  readonly value: CellValue;
  readonly shift: Shift | undefined;
  readonly nonWorking: boolean;
  readonly presence: PresenceMark | undefined;
  readonly pending: PendingMark | undefined;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarMonth({
  month,
  dayAt,
  onPick,
}: {
  readonly month: DateTime;
  readonly dayAt: (date: IsoDate) => CalendarDay;
  readonly onPick: (from: IsoDate, to: IsoDate, x: number, y: number) => void;
}) {
  // The anchor of an in-flight drag. Kept per month rather than per page: a selection
  // across a month boundary is a range nobody asked for and a layout nobody can draw.
  const [anchor, setAnchor] = useState<IsoDate>();
  const [hover, setHover] = useState<IsoDate>();

  const first = month.startOf('month');
  const daysInMonth = month.daysInMonth ?? 30;
  // Monday-first, always: the week is ISO everywhere else in this product.
  const lead = first.weekday - 1;

  const dates: (IsoDate | undefined)[] = [
    ...Array.from({ length: lead }, () => undefined),
    ...Array.from({ length: daysInMonth }, (_, i) => first.plus({ days: i }).toISODate() as IsoDate),
  ];

  const selection =
    anchor && hover
      ? { from: anchor < hover ? anchor : hover, to: anchor < hover ? hover : anchor }
      : undefined;

  const finish = (date: IsoDate, event: React.MouseEvent) => {
    const from = anchor && anchor < date ? anchor : date;
    const to = anchor && anchor < date ? date : (anchor ?? date);
    setAnchor(undefined);
    setHover(undefined);
    onPick(from, to, event.clientX, event.clientY);
  };

  return (
    <section className="calendar__month">
      <h2 className="calendar__title">{month.toFormat('LLLL yyyy')}</h2>

      <div className="calendar__grid" role="grid" aria-label={month.toFormat('LLLL yyyy')}>
        {WEEKDAYS.map((label) => (
          <div key={label} className="calendar__weekday" role="columnheader">
            {label}
          </div>
        ))}

        {dates.map((date, index) =>
          date === undefined ? (
            <div key={`pad-${index}`} className="calendar__pad" aria-hidden />
          ) : (
            <DayBox
              key={date}
              day={dayAt(date)}
              selected={
                selection !== undefined && date >= selection.from && date <= selection.to
              }
              onMouseDown={() => {
                setAnchor(date);
                setHover(date);
              }}
              onMouseEnter={() => anchor && setHover(date)}
              onMouseUp={(event) => finish(date, event)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!selection || date < selection.from || date > selection.to) {
                  onPick(date, date, event.clientX, event.clientY);
                  return;
                }
                onPick(selection.from, selection.to, event.clientX, event.clientY);
              }}
            />
          ),
        )}
      </div>
    </section>
  );
}

function DayBox({
  day,
  selected,
  onMouseDown,
  onMouseEnter,
  onMouseUp,
  onContextMenu,
}: {
  readonly day: CalendarDay;
  readonly selected: boolean;
  readonly onMouseDown: () => void;
  readonly onMouseEnter: () => void;
  readonly onMouseUp: (event: React.MouseEvent) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { value } = day;
  const event = value.kind === 'STATUS' || value.kind === 'SHIFT' ? value.event : undefined;
  const status = value.kind === 'STATUS' ? value.status : undefined;
  // Not yet asked for or agreed — a system suggestion, drawn as a dashed hint exactly as
  // the grid draws it (ADR-0007). Missing here was the whole reason a comp day looked
  // like it had vanished: nothing on this screen said a day had been proposed at all.
  const proposedCompDay =
    (value.kind === 'EMPTY' || value.kind === 'SHIFT') ? value.proposedCompDay : undefined;

  const today = day.date === new Date().toISOString().slice(0, 10);

  return (
    <div
      className="calendar__day"
      role="gridcell"
      data-nonworking={day.nonWorking || undefined}
      data-selected={selected || undefined}
      data-today={today || undefined}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
    >
      {/* Time off is the day's own ground here as well as in the grid (ADR-0052), so the
          two screens do not disagree about what a day looks like. */}
      {event ? (
        <span
          className="calendar__fill"
          style={{ background: `color-mix(in srgb, ${event.color} 16%, transparent)` }}
          aria-hidden
        />
      ) : null}

      <span className="calendar__num">{day.date.slice(8)}</span>

      <span className="calendar__body">
        {value.kind === 'SHIFT' && day.shift ? (
          <span className="calendar__shift" style={{ backgroundColor: day.shift.color }}>
            <span className="font-mono font-bold">{day.shift.code}</span>
            <span className="calendar__hours">
              {day.shift.start}–{day.shift.end}
            </span>
          </span>
        ) : null}

        {event ? (
          <span className="calendar__label" style={{ color: event.color }}>
            {event.shortLabel}
            {event.portion !== 'FULL' ? (event.portion === 'MORNING' ? ' AM' : ' PM') : ''}
          </span>
        ) : status ? (
          <span className="calendar__label">{STATUS_LABEL[status]}</span>
        ) : null}

        {proposedCompDay ? (
          <span className="calendar__pending">Comp day suggested</span>
        ) : null}

        {day.pending ? (
          <span className="calendar__pending">{day.pending.label}</span>
        ) : null}

        {day.presence ? (
          <span className="calendar__presence" style={{ color: day.presence.color }}>
            {day.presence.label}
          </span>
        ) : null}
      </span>
    </div>
  );
}
