import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import { leadRole, makeDataset, makeDayConfig, nightRole, testRegion } from '../domain/testkit.ts';
import type { DayConfiguration } from '../domain/types.ts';
import { findWeekdayCollisions, resolveDayConfiguration, resolveRequirement } from './dayConfig.ts';

const monThu: DayConfiguration = makeDayConfig({
  id: 'dc-weekday',
  key: 'weekday',
  weekdays: [1, 2, 3, 4],
  roleRequirements: [{ roleId: leadRole.id, min: 1, max: 1, isDefault: true }],
});

const friday: DayConfiguration = makeDayConfig({
  id: 'dc-friday',
  key: 'friday',
  weekdays: [5],
  // У пятницы свой набор ролей, а не другие минимумы того же набора.
  roleRequirements: [{ roleId: nightRole.id, min: 2, isDefault: true }],
});

const weekend: DayConfiguration = makeDayConfig({
  id: 'dc-weekend',
  key: 'weekend',
  weekdays: [6, 7],
  roleRequirements: [{ roleId: leadRole.id, min: 1, isDefault: true }],
});

const holiday: DayConfiguration = makeDayConfig({
  id: 'dc-holiday',
  key: 'holiday',
  weekdays: [],
  roleRequirements: [{ roleId: nightRole.id, min: 1, isDefault: true }],
});

function indexWith(configs: readonly DayConfiguration[], holidays: string[] = []) {
  return buildIndex(
    makeDataset({
      dayConfigurations: configs,
      holidays: holidays.map((date) => ({
        date,
        name: 'Test holiday',
        locationIds: ['loc-ny'],
        isFullDay: true,
      })),
    }),
  );
}

describe('выбор группы дней', () => {
  const index = indexWith([monThu, friday, weekend, holiday], ['2026-09-08']);

  it('понедельник попадает в будни', () => {
    // 2026-09-07 — понедельник.
    expect(resolveDayConfiguration(testRegion.id, '2026-09-07', index)?.id).toBe('dc-weekday');
  });

  it('у пятницы своя группа с другим набором ролей', () => {
    // 2026-09-11 — пятница.
    const config = resolveDayConfiguration(testRegion.id, '2026-09-11', index);
    expect(config?.id).toBe('dc-friday');
    expect(config?.roleRequirements[0]?.roleId).toBe(nightRole.id);
  });

  it('выходные отдельно от будней', () => {
    expect(resolveDayConfiguration(testRegion.id, '2026-09-12', index)?.id).toBe('dc-weekend');
  });

  it('праздник перекрывает будний день', () => {
    // 2026-09-08 — вторник и праздник в календаре Нью-Йорка.
    expect(resolveDayConfiguration(testRegion.id, '2026-09-08', index)?.id).toBe('dc-holiday');
  });

  it('праздничность считается по первичной локации региона, а не человека', () => {
    // Праздник объявлен только для Пуны — для ростера AMER это обычный день.
    const puneOnly = buildIndex(
      makeDataset({
        dayConfigurations: [monThu, friday, weekend, holiday],
        holidays: [
          { date: '2026-09-08', name: 'Pune only', locationIds: ['loc-pune'], isFullDay: true },
        ],
      }),
    );
    expect(resolveDayConfiguration(testRegion.id, '2026-09-08', puneOnly)?.id).toBe('dc-weekday');
  });

  it('без подходящей группы требований нет', () => {
    const weekdaysOnly = indexWith([monThu]);
    expect(resolveDayConfiguration(testRegion.id, '2026-09-12', weekdaysOnly)).toBeUndefined();
  });
});

describe('версионирование по дате вступления (ADR-0021)', () => {
  const v1 = makeDayConfig({
    id: 'dc-v1',
    key: 'weekday',
    weekdays: [1, 2, 3, 4, 5],
    effectiveFrom: '2020-01-01',
    roleRequirements: [{ roleId: leadRole.id, min: 1, isDefault: true }],
  });
  const v2 = makeDayConfig({
    id: 'dc-v2',
    key: 'weekday',
    weekdays: [1, 2, 3, 4, 5],
    effectiveFrom: '2026-09-01',
    roleRequirements: [{ roleId: leadRole.id, min: 2, isDefault: true }],
  });
  const index = indexWith([v1, v2]);

  it('прошлое считается по правилу, действовавшему тогда', () => {
    expect(resolveRequirement(testRegion.id, leadRole.id, '2026-03-02', index)?.min).toBe(1);
  });

  it('после даты вступления действует новая версия', () => {
    expect(resolveRequirement(testRegion.id, leadRole.id, '2026-09-02', index)?.min).toBe(2);
  });

  it('в день вступления действует уже новая версия', () => {
    expect(resolveRequirement(testRegion.id, leadRole.id, '2026-09-01', index)?.min).toBe(2);
  });

  it('версия из будущего на сегодня не влияет', () => {
    const future = makeDayConfig({
      id: 'dc-v3',
      key: 'weekday',
      weekdays: [1, 2, 3, 4, 5],
      effectiveFrom: '2027-01-01',
      roleRequirements: [{ roleId: leadRole.id, min: 9, isDefault: true }],
    });
    const withFuture = indexWith([v1, v2, future]);
    expect(resolveRequirement(testRegion.id, leadRole.id, '2026-09-02', withFuture)?.min).toBe(2);
  });
});

describe('целостность конфигурации', () => {
  it('ловит день недели в двух будних группах', () => {
    const overlapping = makeDayConfig({
      id: 'dc-bad',
      key: 'friday',
      weekdays: [4, 5],
      roleRequirements: [],
    });
    const problems = findWeekdayCollisions([monThu, overlapping]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('weekday 4');
  });

  it('корректная конфигурация проблем не даёт', () => {
    expect(findWeekdayCollisions([monThu, friday, weekend, holiday])).toEqual([]);
  });

  it('разные версии одной группы конфликтом не считаются', () => {
    const v2 = makeDayConfig({
      id: 'dc-weekday-v2',
      key: 'weekday',
      weekdays: [1, 2, 3, 4],
      effectiveFrom: '2026-09-01',
      roleRequirements: [],
    });
    expect(findWeekdayCollisions([monThu, v2])).toEqual([]);
  });
});
