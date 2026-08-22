import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { leadShift, makeDataset, nightShift, nyLocation, puneLocation } from '../domain/testkit.ts';
import {
  addDays,
  countWorkdays,
  daysBetween,
  eachDate,
  holidaysIn,
  intersectIntervals,
  isHolidayIn,
  isNonWorkingDayIn,
  localDateOf,
  restHoursBetween,
  shiftInterval,
  weekdayOf,
} from './dates.ts';

describe('calendar arithmetic', () => {
  it('enumerates a range inclusively', () => {
    expect(eachDate({ from: '2026-08-01', to: '2026-08-04' })).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('returns an empty list for an inverted range', () => {
    expect(eachDate({ from: '2026-08-04', to: '2026-08-01' })).toEqual([]);
  });

  it('counts days in both directions', () => {
    expect(addDays('2026-08-01', -2)).toBe('2026-07-30');
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
  });

  it('numbers weekdays per ISO', () => {
    expect(weekdayOf('2026-08-15')).toBe(6); // Saturday
    expect(weekdayOf('2026-08-17')).toBe(1); // Monday
  });
});

describe('location calendar', () => {
  const index = buildIndex(
    makeDataset({
      holidays: [
        { id: 'hol-labor-day', date: '2026-09-07', name: 'Labor Day', locationIds: ['loc-ny'], isFullDay: true },
        { id: 'hol-independence-day', date: '2026-08-15', name: 'Independence Day', locationIds: ['loc-pune'], isFullDay: true },
      ],
    }),
  );

  it('treats Saturday and Sunday as weekend', () => {
    expect(isNonWorkingDayIn('2026-08-15', nyLocation, index)).toBe(true);
    expect(isNonWorkingDayIn('2026-08-17', nyLocation, index)).toBe(false);
  });

  it('ties a holiday to the location, not the country', () => {
    // September 7 is a holiday in New York and an ordinary Monday in Pune.
    expect(isHolidayIn('2026-09-07', nyLocation, index)).toBe(true);
    expect(isHolidayIn('2026-09-07', puneLocation, index)).toBe(false);
    // August 15 is a holiday in India and an ordinary Saturday in the US.
    expect(isHolidayIn('2026-08-15', puneLocation, index)).toBe(true);
    expect(isHolidayIn('2026-08-15', nyLocation, index)).toBe(false);
  });

  it('counts working days excluding weekends and holidays', () => {
    expect(countWorkdays({ from: '2026-09-07', to: '2026-09-13' }, nyLocation, index)).toBe(4);
    expect(countWorkdays({ from: '2026-09-07', to: '2026-09-13' }, puneLocation, index)).toBe(5);
  });

  it('lists a location\'s holidays within the range', () => {
    expect(holidaysIn({ from: '2026-08-01', to: '2026-12-31' }, nyLocation, index)).toEqual([
      '2026-09-07',
    ]);
    expect(holidaysIn({ from: '2026-08-01', to: '2026-12-31' }, puneLocation, index)).toEqual([
      '2026-08-15',
    ]);
    // Outside the range, it is excluded.
    expect(holidaysIn({ from: '2026-10-01', to: '2026-12-31' }, puneLocation, index)).toEqual([]);
  });
});

describe('shift window', () => {
  it('converts a shift\'s local window to UTC', () => {
    // Summer: New York is UTC-4, so 07:00 local is 11:00 UTC.
    expect(shiftInterval(leadShift, '2026-08-17')).toEqual({
      start: '2026-08-17T11:00:00Z',
      end: '2026-08-17T19:00:00Z',
    });
  });

  it('shifts along with the transition to standard time', () => {
    // The same local window yields a different UTC interval — this is exactly
    // why the window is stored as local time in a named timezone.
    expect(shiftInterval(leadShift, '2026-12-15')).toEqual({
      start: '2026-12-15T12:00:00Z',
      end: '2026-12-15T20:00:00Z',
    });
  });

  it('pushes a night shift\'s end to the next day', () => {
    expect(shiftInterval(nightShift, '2026-08-17')).toEqual({
      start: '2026-08-18T02:00:00Z',
      end: '2026-08-18T10:00:00Z',
    });
  });

  it('applies a one-off time override', () => {
    const interval = shiftInterval(leadShift, '2026-08-17', {
      start: '08:00',
      end: '16:00',
      crossesMidnight: false,
    });
    expect(interval.start).toBe('2026-08-17T12:00:00Z');
  });

  it('belongs to its start date, but for someone in Pune that is already tomorrow', () => {
    expect(localDateOf(shiftInterval(leadShift, '2026-08-17').start, 'Asia/Kolkata')).toBe(
      '2026-08-17',
    );
    expect(localDateOf(shiftInterval(nightShift, '2026-08-17').start, 'Asia/Kolkata')).toBe(
      '2026-08-18',
    );
  });
});

describe('intervals', () => {
  it('counts rest time between shifts', () => {
    const first = shiftInterval(leadShift, '2026-08-17');
    const second = shiftInterval(leadShift, '2026-08-18');
    expect(restHoursBetween(first, second)).toBe(16);
  });

  it('detects insufficient rest after a night shift', () => {
    // The night shift on the 16th ends at 06:00 New York time on the 17th;
    // the day shift starts at 07:00 the same day: one hour instead of eleven.
    const night = shiftInterval(nightShift, '2026-08-16');
    const day = shiftInterval(leadShift, '2026-08-17');
    expect(restHoursBetween(night, day)).toBe(1);
  });

  it('finds the intersection of overlapping intervals', () => {
    const emea = { start: '2026-08-17T06:00:00Z', end: '2026-08-17T14:00:00Z' };
    const amer = { start: '2026-08-17T11:00:00Z', end: '2026-08-17T19:00:00Z' };
    expect(intersectIntervals(emea, amer)).toEqual({
      start: '2026-08-17T11:00:00Z',
      end: '2026-08-17T14:00:00Z',
    });
  });

  it('returns undefined when there is no intersection', () => {
    const a = { start: '2026-08-17T06:00:00Z', end: '2026-08-17T10:00:00Z' };
    const b = { start: '2026-08-17T11:00:00Z', end: '2026-08-17T19:00:00Z' };
    expect(intersectIntervals(a, b)).toBeUndefined();
  });
});
