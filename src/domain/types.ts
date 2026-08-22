/**
 * Доменная модель shift-o-mator.
 *
 * Решения, на которых держится эта модель, описаны в Docs/adr/.
 * Ключевое: роль несёт своё время (ADR-0001), локация отвечает только за календарь
 * и отображение (ADR-0002).
 *
 * Этот модуль не зависит ни от чего, кроме стандартной библиотеки.
 */

// ---------------------------------------------------------------------------
// Примитивы
// ---------------------------------------------------------------------------

/** Календарная дата, `YYYY-MM-DD`. Трактуется в таймзоне, заданной контекстом. */
export type IsoDate = string;

/** Момент времени в UTC, ISO 8601 с суффиксом `Z`. */
export type IsoInstant = string;

/** Время суток `HH:mm` без даты и без таймзоны. */
export type TimeOfDay = string;

/** Идентификатор таймзоны IANA, например `America/New_York`. */
export type IanaZone = string;

/** День недели по ISO: 1 — понедельник, 7 — воскресенье (нумерация Luxon). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MONDAY = 1 as const;
export const SATURDAY = 6 as const;
export const SUNDAY = 7 as const;

export type LocationId = string;
export type UnitId = string;
export type RoleId = string;
export type PersonId = string;
export type AssignmentId = string;
export type AbsenceId = string;
export type CompDayEntryId = string;
export type CoverageRuleId = string;
export type AbsenceCapacityRuleId = string;

/** Полуоткрытый интервал времени `[start, end)` в UTC. */
export interface UtcInterval {
  readonly start: IsoInstant;
  readonly end: IsoInstant;
}

/** Период планирования, обе границы включительно. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

// ---------------------------------------------------------------------------
// Локация и календарь
// ---------------------------------------------------------------------------

/** Ключ национального календаря праздников: `US`, `GB`, `CH`, `SG`, `IN`. */
export type HolidayCalendarKey = string;

/**
 * Локация отвечает ровно за две вещи: календарь нерабочих дней и таймзону
 * отображения. Ко времени смены отношения не имеет — см. ADR-0002.
 */
export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly timeZone: IanaZone;
  readonly holidayCalendarKey: HolidayCalendarKey;
  /** Дни недели, считающиеся выходными в этой локации. */
  readonly weekendDays: readonly Weekday[];
}

export interface Holiday {
  readonly calendarKey: HolidayCalendarKey;
  readonly date: IsoDate;
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Единица планирования
// ---------------------------------------------------------------------------

export type CompDayTrigger = 'SATURDAY' | 'SUNDAY' | 'HOLIDAY';

export interface CompDayRule {
  readonly workedOn: CompDayTrigger;
  /** Смещение предлагаемого отгула в календарных днях от отработанной даты. */
  readonly defaultOffsetDays: number;
}

/** Политика начисления отгулов, задаётся на единице планирования. См. ADR-0007. */
export interface CompDayPolicy {
  readonly rules: readonly CompDayRule[];
  /** Через сколько недель неотгуленный день сгорает. */
  readonly expiryWeeks: number;
}

/**
 * Организационная, а не географическая граница — см. ADR-0003.
 * В интерфейсе называется «регион».
 */
export interface PlanningUnit {
  readonly id: UnitId;
  readonly name: string;
  /** Кто вправе редактировать план этой единицы. */
  readonly plannerPersonIds: readonly PersonId[];
  readonly compDayPolicy: CompDayPolicy;
  /**
   * Локация, по календарю которой день классифицируется для правил покрытия
   * (`WEEKDAY` / `WEEKEND` / `HOLIDAY`). Календарь comp days при этом всегда
   * берётся по локации самого человека.
   */
  readonly coverageCalendarLocationId: LocationId;
}

// ---------------------------------------------------------------------------
// Роль
// ---------------------------------------------------------------------------

/**
 * Роль несёт своё время — см. ADR-0001. Окно задано в фиксированной таймзоне
 * роли, а не в таймзоне человека и не в UTC-смещении.
 *
 * Роль принадлежит единице планирования; глобального справочника ролей нет
 * (ADR-0004), совпадение кодов между единицами ничего не означает.
 */
export interface ShiftRole {
  readonly id: RoleId;
  readonly unitId: UnitId;
  /** Короткий код для сетки: `SL`, `BATCH`, `CAVA`. */
  readonly code: string;
  readonly label: string;
  /** CSS-цвет чипа роли. */
  readonly color: string;
  /** Клавиша быстрого ввода в сетке. Уникальна в пределах единицы. */
  readonly hotkey?: string;
  readonly timeZone: IanaZone;
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  /** Окно переходит через полночь: `22:00`–`06:00`. */
  readonly crossesMidnight: boolean;
  /** Можно ли править время в конкретной ячейке. */
  readonly editableTime: boolean;
  /** Участвует ли роль в расчёте покрытия. */
  readonly countsAsCoverage: boolean;
}

// ---------------------------------------------------------------------------
// Человек
// ---------------------------------------------------------------------------

/**
 * Доступность роли с целевой долей вместо булева флага — см. ADR-0006.
 * Справедливость считается как отклонение фактической доли от целевой.
 */
export interface RoleEligibility {
  readonly roleId: RoleId;
  /** Желаемая доля этой роли в нагрузке человека, 0..1. Веса, не вероятности. */
  readonly targetShare: number;
  readonly minPerWeek?: number;
  readonly maxPerWeek?: number;
}

export interface PersonConstraints {
  /** Минимальный отдых между концом одной смены и началом следующей. */
  readonly minRestHours: number;
  readonly maxConsecutiveDays: number;
  /** Сколько выходных дней подряд с работой допустимо за 4 недели. */
  readonly maxWeekendDaysPer4Weeks?: number;
}

export interface PersonPreferences {
  /** Дни недели, которые человек предпочитает не работать. Уровень INFO. */
  readonly avoidsWeekdays?: readonly Weekday[];
  readonly prefersRoleIds?: readonly RoleId[];
  readonly note?: string;
}

/**
 * Отдельной сущности «рабочий паттерн» нет — см. ADR-0005. Участие в ротации
 * определяется набором доступных ролей и днями доступности.
 */
export interface Person {
  readonly id: PersonId;
  readonly displayName: string;
  readonly employeeId: string;
  readonly unitId: UnitId;
  readonly locationId: LocationId;
  /** Менеджеры: в сетке планирования не участвуют. */
  readonly isPlannerOnly: boolean;
  readonly eligibility: readonly RoleEligibility[];
  readonly availableWeekdays: readonly Weekday[];
  readonly constraints: PersonConstraints;
  readonly preferences?: PersonPreferences;
  /** Для ICS-подписки. Заложен в модель сразу, используется начиная с этапа 11. */
  readonly calendarToken: string;
}

// ---------------------------------------------------------------------------
// Назначение
// ---------------------------------------------------------------------------

export type AssignmentSource = 'MANUAL' | 'GENERATED' | 'PATTERN';

/** Разовое переопределение времени роли в конкретной ячейке. */
export interface TimeOverride {
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  readonly crossesMidnight: boolean;
}

/**
 * Назначение человека на роль в конкретную дату.
 *
 * `date` — локальная дата смены **по таймзоне роли**. Это устраняет
 * неоднозначность для смен, пересекающих полночь.
 */
export interface Assignment {
  readonly id: AssignmentId;
  readonly personId: PersonId;
  readonly roleId: RoleId;
  readonly date: IsoDate;
  readonly source: AssignmentSource;
  readonly timeOverride?: TimeOverride;
  readonly note?: string;
  readonly createdBy: PersonId;
  readonly createdAt: IsoInstant;
}

// ---------------------------------------------------------------------------
// Отсутствие
// ---------------------------------------------------------------------------

export type AbsenceType = 'VACATION' | 'COMP_DAY' | 'TRAINING' | 'SICK' | 'OTHER';
export type AbsenceSource = 'IMPORT' | 'MANUAL';

/** Отсутствие. Диапазон дат включительно, в календаре локации человека. */
export interface Absence {
  readonly id: AbsenceId;
  readonly personId: PersonId;
  readonly type: AbsenceType;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Ручные записи импорт никогда не перетирает. */
  readonly source: AbsenceSource;
  readonly importBatchId?: string;
  /** Для обнаружения записей, исчезнувших из очередной выгрузки. */
  readonly lastSeenInImportAt?: IsoInstant;
  /** Занесено ли обратно в корпоративную систему. */
  readonly syncedToHrAt?: IsoInstant;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Comp day
// ---------------------------------------------------------------------------

export type CompDayStatus = 'PROPOSED' | 'SCHEDULED' | 'TAKEN' | 'EXPIRED' | 'DECLINED';

/**
 * Начисление отгула с балансом, а не событие в расписании — см. ADR-0007.
 * Начисление порождается системой как предложение и подтверждается планировщиком.
 */
export interface CompDayEntry {
  readonly id: CompDayEntryId;
  readonly personId: PersonId;
  readonly earnedForAssignmentId: AssignmentId;
  readonly earnedForDate: IsoDate;
  readonly trigger: CompDayTrigger;
  /** Дата из политики единицы. */
  readonly proposedDate: IsoDate;
  /** Дата после переноса планировщиком. */
  readonly actualDate?: IsoDate;
  readonly status: CompDayStatus;
  readonly expiresOn: IsoDate;
  readonly syncedToHrAt?: IsoInstant;
}

/** Дата, на которую отгул реально блокирует человека. */
export function effectiveCompDayDate(entry: CompDayEntry): IsoDate {
  return entry.actualDate ?? entry.proposedDate;
}

/** Блокирует ли отгул назначение. `PROPOSED` пока не блокирует — это предложение. */
export function compDayBlocksAssignment(entry: CompDayEntry): boolean {
  return entry.status === 'SCHEDULED' || entry.status === 'TAKEN';
}

// ---------------------------------------------------------------------------
// Правила покрытия
// ---------------------------------------------------------------------------

export type CoverageScope = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'DATE';

/**
 * Требование покрытия. Правило с `DATE` перекрывает `HOLIDAY`, оно — `WEEKEND`,
 * оно — `WEEKDAY`. События (DR-тест, закрытие месяца) описываются правилами
 * с датой, а не отдельной сущностью — см. ADR-0008.
 */
export interface CoverageRule {
  readonly id: CoverageRuleId;
  readonly unitId: UnitId;
  readonly roleId: RoleId;
  readonly appliesTo: CoverageScope;
  /** Только для `appliesTo === 'DATE'`. */
  readonly date?: IsoDate;
  /** Метка события: `DR test`, `Month end`. Показывается в полосе покрытия. */
  readonly label?: string;
  /** Жёсткое требование. Недобор — уровень BLOCKING. */
  readonly min: number;
  /** Желательное. Недобор — уровень WARNING. */
  readonly target?: number;
  /** Чтобы не переливать людей. Перебор — уровень WARNING. */
  readonly max?: number;
}

export type CoverageLevel = 'BELOW_MIN' | 'BELOW_TARGET' | 'OK' | 'OVER_MAX';

/** Результат расчёта покрытия: одна клетка полосы под сеткой. */
export interface CoverageCell {
  readonly date: IsoDate;
  readonly roleId: RoleId;
  readonly actual: number;
  readonly min: number;
  readonly target?: number;
  readonly max?: number;
  readonly level: CoverageLevel;
  /** Метка правила, если день покрыт правилом с датой. */
  readonly ruleLabel?: string;
  readonly appliedScope: CoverageScope;
}

// ---------------------------------------------------------------------------
// Лимиты одновременных отсутствий
// ---------------------------------------------------------------------------

export type AbsenceCapacityScope =
  | { readonly kind: 'UNIT' }
  | { readonly kind: 'ROLE_POOL'; readonly roleId: RoleId };

export type AbsenceDurationBucket = 'SHORT' | 'LONG';

/**
 * Лимит одновременно отсутствующих. Ограничение по пулу ролей важнее общего —
 * см. ADR-0010: трое из четырёх, кто умеет быть shift lead, это проблема,
 * которую счётчик по единице не увидит.
 */
export interface AbsenceCapacityRule {
  readonly id: AbsenceCapacityRuleId;
  readonly unitId: UnitId;
  readonly scope: AbsenceCapacityScope;
  readonly durationBucket: AbsenceDurationBucket;
  /** Начиная со скольких рабочих дней отсутствие считается длительным. */
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsTypes: readonly AbsenceType[];
}

// ---------------------------------------------------------------------------
// Валидация
// ---------------------------------------------------------------------------

export type IssueLevel = 'BLOCKING' | 'WARNING' | 'INFO';

export type IssueCode =
  | 'COVERAGE_BELOW_MIN'
  | 'COVERAGE_BELOW_TARGET'
  | 'COVERAGE_OVER_MAX'
  | 'ASSIGNED_DURING_ABSENCE'
  | 'ASSIGNED_DURING_COMP_DAY'
  | 'DOUBLE_ASSIGNMENT'
  | 'ROLE_NOT_ELIGIBLE'
  | 'ROLE_OUTSIDE_UNIT'
  | 'ABSENCE_CAPACITY_EXCEEDED'
  | 'MIN_REST_VIOLATED'
  | 'CONSECUTIVE_DAYS_EXCEEDED'
  | 'WEEKEND_LOAD_EXCEEDED'
  | 'UNAVAILABLE_WEEKDAY'
  | 'PREFERENCE_VIOLATED'
  | 'TARGET_SHARE_DEVIATION'
  | 'COMP_DAY_EXPIRING';

/**
 * Найденное нарушение. Якорь (`date`, `personId`, `roleId`) нужен, чтобы клик
 * в боковой панели вёл в конкретную ячейку сетки. Три уровня — см. ADR-0009.
 */
export interface Issue {
  /** Стабильный ключ: одно и то же нарушение даёт один и тот же ключ между
   *  пересчётами. По нему находится подтверждение. */
  readonly key: string;
  readonly level: IssueLevel;
  readonly code: IssueCode;
  readonly message: string;
  readonly unitId: UnitId;
  readonly date?: IsoDate;
  readonly personId?: PersonId;
  readonly roleId?: RoleId;
}

/** Осознанное подтверждение нарушения уровня WARNING. Хранится вместе с планом. */
export interface Acknowledgement {
  readonly issueKey: string;
  readonly comment: string;
  readonly byPersonId: PersonId;
  readonly at: IsoInstant;
}

// ---------------------------------------------------------------------------
// Блокировка периода
// ---------------------------------------------------------------------------

/** Check-out на пару (единица, период) — см. ADR-0011. Real-time не делаем. */
export interface PeriodLock {
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly byPersonId: PersonId;
  readonly acquiredAt: IsoInstant;
  readonly expiresAt: IsoInstant;
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

/** Справочная часть состояния: меняется на экране настроек, не при планировании. */
export interface ReferenceData {
  readonly locations: readonly Location[];
  readonly holidays: readonly Holiday[];
  readonly units: readonly PlanningUnit[];
  readonly roles: readonly ShiftRole[];
  readonly people: readonly Person[];
  readonly coverageRules: readonly CoverageRule[];
  readonly absenceCapacityRules: readonly AbsenceCapacityRule[];
}

/** Планируемая часть состояния: то, что правит планировщик. */
export interface PlanData {
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly acknowledgements: readonly Acknowledgement[];
}

export interface ScheduleDataset extends ReferenceData, PlanData {}
