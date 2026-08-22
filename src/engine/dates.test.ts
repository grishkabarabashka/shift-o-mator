import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { leadRole, makeDataset, nightRole, nyLocation, puneLocation } from '../domain/testkit.ts';
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

describe('календарная арифметика', () => {
  it('перечисляет период включительно', () => {
    expect(eachDate({ from: '2026-08-01', to: '2026-08-04' })).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('возвращает пустой список для перевёрнутого периода', () => {
    expect(eachDate({ from: '2026-08-04', to: '2026-08-01' })).toEqual([]);
  });

  it('считает дни в обе стороны', () => {
    expect(addDays('2026-08-01', -2)).toBe('2026-07-30');
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
  });

  it('нумерует дни недели по ISO', () => {
    expect(weekdayOf('2026-08-15')).toBe(6); // суббота
    expect(weekdayOf('2026-08-17')).toBe(1); // понедельник
  });
});

describe('календарь локации', () => {
  const index = buildIndex(
    makeDataset({
      holidays: [
        { id: 'hol-labor-day', date: '2026-09-07', name: 'Labor Day', locationIds: ['loc-ny'], isFullDay: true },
        { id: 'hol-independence-day', date: '2026-08-15', name: 'Independence Day', locationIds: ['loc-pune'], isFullDay: true },
      ],
    }),
  );

  it('считает выходным субботу и воскресенье', () => {
    expect(isNonWorkingDayIn('2026-08-15', nyLocation, index)).toBe(true);
    expect(isNonWorkingDayIn('2026-08-17', nyLocation, index)).toBe(false);
  });

  it('праздник привязан к локации, а не к стране', () => {
    // 7 сентября — праздник в Нью-Йорке и обычный понедельник в Пуне.
    expect(isHolidayIn('2026-09-07', nyLocation, index)).toBe(true);
    expect(isHolidayIn('2026-09-07', puneLocation, index)).toBe(false);
    // 15 августа — праздник в Индии и обычная суббота в США.
    expect(isHolidayIn('2026-08-15', puneLocation, index)).toBe(true);
    expect(isHolidayIn('2026-08-15', nyLocation, index)).toBe(false);
  });

  it('считает рабочие дни без выходных и праздников', () => {
    expect(countWorkdays({ from: '2026-09-07', to: '2026-09-13' }, nyLocation, index)).toBe(4);
    expect(countWorkdays({ from: '2026-09-07', to: '2026-09-13' }, puneLocation, index)).toBe(5);
  });

  it('перечисляет праздники локации в периоде', () => {
    expect(holidaysIn({ from: '2026-08-01', to: '2026-12-31' }, nyLocation, index)).toEqual([
      '2026-09-07',
    ]);
    expect(holidaysIn({ from: '2026-08-01', to: '2026-12-31' }, puneLocation, index)).toEqual([
      '2026-08-15',
    ]);
    // За пределами периода не попадает.
    expect(holidaysIn({ from: '2026-10-01', to: '2026-12-31' }, puneLocation, index)).toEqual([]);
  });
});

describe('окно смены', () => {
  it('переводит локальное окно роли в UTC', () => {
    // Лето: Нью-Йорк на UTC−4, значит 07:00 локальных — это 11:00 UTC.
    expect(shiftInterval(leadRole, '2026-08-17')).toEqual({
      start: '2026-08-17T11:00:00Z',
      end: '2026-08-17T19:00:00Z',
    });
  });

  it('сдвигается вместе с переходом на зимнее время', () => {
    // То же локальное окно даёт другой UTC-интервал — ради этого окно и
    // хранится как локальное время в именованной таймзоне.
    expect(shiftInterval(leadRole, '2026-12-15')).toEqual({
      start: '2026-12-15T12:00:00Z',
      end: '2026-12-15T20:00:00Z',
    });
  });

  it('уводит конец ночной смены на следующий день', () => {
    expect(shiftInterval(nightRole, '2026-08-17')).toEqual({
      start: '2026-08-18T02:00:00Z',
      end: '2026-08-18T10:00:00Z',
    });
  });

  it('применяет разовое переопределение времени', () => {
    const interval = shiftInterval(leadRole, '2026-08-17', {
      start: '08:00',
      end: '16:00',
      crossesMidnight: false,
    });
    expect(interval.start).toBe('2026-08-17T12:00:00Z');
  });

  it('ночная смена принадлежит дате начала, но у человека из Пуны это уже завтра', () => {
    expect(localDateOf(shiftInterval(leadRole, '2026-08-17').start, 'Asia/Kolkata')).toBe(
      '2026-08-17',
    );
    expect(localDateOf(shiftInterval(nightRole, '2026-08-17').start, 'Asia/Kolkata')).toBe(
      '2026-08-18',
    );
  });
});

describe('интервалы', () => {
  it('считает отдых между сменами', () => {
    const first = shiftInterval(leadRole, '2026-08-17');
    const second = shiftInterval(leadRole, '2026-08-18');
    expect(restHoursBetween(first, second)).toBe(16);
  });

  it('видит нехватку отдыха после ночной смены', () => {
    // Ночь 16-го кончается в 06:00 по Нью-Йорку 17-го, дневная начинается
    // в 07:00 того же дня: один час вместо одиннадцати.
    const night = shiftInterval(nightRole, '2026-08-16');
    const day = shiftInterval(leadRole, '2026-08-17');
    expect(restHoursBetween(night, day)).toBe(1);
  });

  it('находит пересечение интервалов для зон overlap', () => {
    const emea = { start: '2026-08-17T06:00:00Z', end: '2026-08-17T14:00:00Z' };
    const amer = { start: '2026-08-17T11:00:00Z', end: '2026-08-17T19:00:00Z' };
    expect(intersectIntervals(emea, amer)).toEqual({
      start: '2026-08-17T11:00:00Z',
      end: '2026-08-17T14:00:00Z',
    });
  });

  it('возвращает undefined, если пересечения нет', () => {
    const a = { start: '2026-08-17T06:00:00Z', end: '2026-08-17T10:00:00Z' };
    const b = { start: '2026-08-17T11:00:00Z', end: '2026-08-17T19:00:00Z' };
    expect(intersectIntervals(a, b)).toBeUndefined();
  });
});
