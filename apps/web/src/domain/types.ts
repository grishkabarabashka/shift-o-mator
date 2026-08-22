/**
 * Доменная модель shift-o-mator.
 *
 * Решения — в Docs/adr/. Ключевые для этого файла:
 *   Phase 8   Region удалён; PlanningUnit — единственная ось правил
 *   ADR-0001  смена несёт своё абсолютное время (единая сущность Shift)
 *   ADR-0016  day configuration несёт набор смен, а не только минимумы
 *   ADR-0017  Absence — диапазон, ячейка — проекция
 *   ADR-0015  черновики и публикация
 *   ADR-0021  конфигурация версионируется датой вступления
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
export const FRIDAY = 5 as const;
export const SATURDAY = 6 as const;
export const SUNDAY = 7 as const;

export type LocationId = string;
export type UnitId = string;

/**
 * Псевдо-единица «все»: фильтра по единице нет.
 *
 * Единица планирования — фильтр по умолчанию, а не граница (ADR-0020), и
 * дефолтом должно быть «вижу всех». Команда небольшая, а вопрос, ради которого
 * люди открывают этот продукт, — «закрыты ли мы глобально»; ответ на него
 * нельзя давать по одному юниту за раз. Выбор конкретной единицы сужает
 * список, а не открывает доступ.
 */
export const ALL_UNITS: UnitId = 'ALL';
export type ShiftId = string;
export type PersonId = string;
export type AssignmentId = string;
export type AbsenceId = string;
export type CompDayEntryId = string;
export type DayConfigId = string;
export type DraftSessionId = string;

/** Полуоткрытый интервал времени `[start, end)` в UTC. */
export interface UtcInterval {
  readonly start: IsoInstant;
  readonly end: IsoInstant;
}

/** Период, обе границы включительно. */
export interface DateRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

// ---------------------------------------------------------------------------
// Локация и календарь
// ---------------------------------------------------------------------------

export type HolidayCalendarKey = string;

/**
 * Локация отвечает ровно за две вещи: календарь нерабочих дней и таймзону
 * отображения. Ко времени смены отношения не имеет. Многие-ко-многим с
 * PlanningUnit — Pune хостит людей трёх разных юнитов.
 */
export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly country: string;
  readonly timeZone: IanaZone;
  readonly holidayCalendarKey: HolidayCalendarKey;
  readonly weekendDays: readonly Weekday[];
}

export interface Holiday {
  readonly id: string;
  readonly date: IsoDate;
  readonly name: string;
  readonly locationIds: readonly LocationId[];
  readonly isFullDay: boolean;
}

// ---------------------------------------------------------------------------
// Единица планирования — единственная ось правил
// ---------------------------------------------------------------------------

export type CompDayTrigger = 'SATURDAY' | 'SUNDAY' | 'HOLIDAY';

/**
 * Политика отгулов. Дата подбирается поиском в окне, а не фиксированным
 * смещением, и отгулы не сгорают — ADR-0007. Теперь принадлежит юниту
 * (раньше — региону).
 */
export interface CompOffPolicy {
  readonly windowBeforeDays: number;
  readonly windowAfterDays: number;
  /** Дни недели, на которые отгул не ставится. По умолчанию Пн и Пт. */
  readonly excludedWeekdays: readonly Weekday[];
  /** Через сколько дней после начисления неотгуленный день подсвечивается. */
  readonly agingThresholdDays: number;
  readonly requiresApprovalWhenNoSlot: boolean;
}

export type UnitKind = 'REGION' | 'CROSS_REGION';

/** По чему группируются строки сетки внутри единицы. */
export type GroupBy = 'LOCATION' | 'REGION' | 'ORG_CATEGORY';

/**
 * Единица планирования — единственная ось правил (Region удалён, Phase 8):
 * задаёт, какие смены и конфигурации дня действуют, чей календарь
 * отсутствий считается, и чья политика отгулов применяется. Фильтр по
 * умолчанию для экрана, а не граница прав.
 */
export interface PlanningUnit {
  readonly id: UnitId;
  readonly name: string;
  readonly kind: UnitKind;
  readonly groupBy: GroupBy;
  /** Чей календарь праздников решает «праздник ли это для ростера». */
  readonly primaryLocationId: LocationId;
  readonly locationIds: readonly LocationId[];
  readonly compOffPolicy: CompOffPolicy;
}

// ---------------------------------------------------------------------------
// Смена
// ---------------------------------------------------------------------------

/**
 * Единственная сущность времени: смена несёт абсолютное окно в
 * фиксированной таймзоне (Phase 8 — слияние бывших ShiftRole/ShiftDefinition).
 * Принадлежит единице планирования; глобального справочника нет.
 */
export interface Shift {
  readonly id: ShiftId;
  readonly unitId: UnitId;
  readonly code: string;
  readonly label: string;
  /** Операционное назначение смены: показывается в пикере и настройках. */
  readonly description?: string;
  readonly color: string;
  readonly hotkey?: string;
  readonly timeZone: IanaZone;
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  readonly crossesMidnight: boolean;
  readonly breakMinutes: number;
  readonly countsAsCoverage: boolean;
  readonly editableTime: boolean;
}

// ---------------------------------------------------------------------------
// Конфигурация дня
// ---------------------------------------------------------------------------

/**
 * `date` зарезервирован под событийные конфигурации и пока не реализован —
 * ADR-0008. Порядок разрешения: DATE → HOLIDAY → WEEKEND → группа будней.
 */
export type DayConfigKey = 'weekday' | 'friday' | 'weekend' | 'holiday' | 'date';

export interface ShiftRequirement {
  readonly shiftId: ShiftId;
  /** Жёсткое требование. Ниже — дыра. Ноль — легальное состояние (ADR Phase 8):
   * юнит может нести смену без обязательства по покрытию. */
  readonly min: number;
  /** Выше — предупреждение. `undefined` = без ограничения. */
  readonly max?: number;
  /** Предлагается в пикере даже без требования. */
  readonly isDefault: boolean;
  /** Смена в этой группе дней идёт в другое время. */
  readonly timingOverride?: TimeOverride;
}

/**
 * Группа дней со своим набором смен — ADR-0016. Версионируется датой
 * вступления: правило, поднятое сегодня, не перекрашивает прошлый март
 * (ADR-0021).
 */
export interface DayConfiguration {
  readonly id: DayConfigId;
  readonly unitId: UnitId;
  readonly key: DayConfigKey;
  /** Для будних групп. Каждый день недели принадлежит ровно одной группе. */
  readonly weekdays: readonly Weekday[];
  /** Только для `key === 'date'`. */
  readonly date?: IsoDate;
  readonly label?: string;
  readonly effectiveFrom: IsoDate;
  readonly shiftRequirements: readonly ShiftRequirement[];
}

// ---------------------------------------------------------------------------
// Человек
// ---------------------------------------------------------------------------

export type OrgCategory = 'SUPPORT' | 'SERVICE_TRANSITION' | 'MANAGEMENT';

/**
 * Доступность смены с целевой долей вместо булева флага — ADR-0006.
 * Доля — метрика справедливости; порядок кандидатов считается отдельно.
 */
export interface ShiftEligibility {
  readonly shiftId: ShiftId;
  readonly targetShare: number;
  readonly minPerWeek?: number;
  readonly maxPerWeek?: number;
}

export interface PersonConstraints {
  readonly minRestHours: number;
  readonly maxConsecutiveDays: number;
  readonly maxWeekendsPerQuarter?: number;
}

export interface PersonPreferences {
  readonly avoidsWeekdays?: readonly Weekday[];
  readonly preferredPartnerIds?: readonly PersonId[];
  readonly blackoutDates?: readonly IsoDate[];
  readonly note?: string;
}

/**
 * Отдельной сущности «рабочий паттерн» нет — ADR-0005. `defaultShiftId` и
 * `availableWeekdays` читает только автогенерация. `defaultShiftId` теперь
 * единственное поле смены на человеке (Phase 8 удалил параллельный
 * `ShiftDefinition`/`defaultRoleId`): один и тот же код смены и для
 * покрытия, и для ростер-контекста.
 */
export interface Person {
  readonly id: PersonId;
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId?: string;
  /** Чьи правила применяются и на чьём экране человек планируется. */
  readonly unitId: UnitId;
  readonly locationId: LocationId;
  readonly orgCategory: OrgCategory;
  readonly isActive: boolean;
  /** Участвует ли в планировании вообще. Менеджеры: false. */
  readonly isIncluded: boolean;
  readonly eligibility: readonly ShiftEligibility[];
  readonly availableWeekdays: readonly Weekday[];
  readonly defaultShiftId?: ShiftId;
  readonly weekendEligible: boolean;
  readonly constraints: PersonConstraints;
  readonly preferences?: PersonPreferences;
  readonly calendarToken: string;
}

// ---------------------------------------------------------------------------
// Назначение
// ---------------------------------------------------------------------------

export type AssignmentSource = 'MANUAL' | 'GENERATED' | 'IMPORTED';

/** Разовое переопределение времени смены. */
export interface TimeOverride {
  readonly start: TimeOfDay;
  readonly end: TimeOfDay;
  readonly crossesMidnight: boolean;
}

/** `OFF` — запланированный выходной (`Off`/`W-Off`). `NOT_SCHEDULED` — `0`. */
export type RosterMarker = 'OFF' | 'NOT_SCHEDULED';

export type AssignmentContent =
  | { readonly kind: 'SHIFT'; readonly shiftId: ShiftId; readonly timeOverride?: TimeOverride }
  | { readonly kind: 'MARKER'; readonly marker: RosterMarker };

/**
 * Ровно одно назначение на пару (человек, дата) — жёсткое ограничение.
 * On-call — обычный код смены, занимающий день, а не параллельное дежурство.
 *
 * `date` — локальная дата смены по её таймзоне: это снимает неоднозначность
 * для смен через полночь.
 */
export interface Assignment {
  readonly id: AssignmentId;
  readonly personId: PersonId;
  readonly date: IsoDate;
  /** Денормализовано из юнита человека на момент записи. */
  readonly unitId: UnitId;
  readonly content: AssignmentContent;
  /** Выходной по календарю локации человека. */
  readonly isWeekend: boolean;
  readonly note?: string;
  readonly source: AssignmentSource;
  /** Токен оптимистичной блокировки. */
  readonly version: number;
  readonly createdBy: PersonId;
  readonly createdAt: IsoInstant;
  readonly updatedBy?: PersonId;
  readonly updatedAt?: IsoInstant;
}

export function assignmentShiftId(assignment: Assignment): ShiftId | undefined {
  return assignment.content.kind === 'SHIFT' ? assignment.content.shiftId : undefined;
}

export function isWorkingAssignment(assignment: Assignment): boolean {
  return assignment.content.kind === 'SHIFT';
}

// ---------------------------------------------------------------------------
// Отсутствие
// ---------------------------------------------------------------------------

/**
 * Обучение сюда не входит: тренинги в рабочее время — это смена `Cover`,
 * человек на работе и попадает в покрытие (ADR-0017).
 */
export type AbsenceType = 'VACATION' | 'SICK' | 'OTHER';

export type AbsenceSource = 'IMPORT' | 'MANUAL';

/** Отпуск — диапазон, и диапазон является источником истины (ADR-0017). */
export interface Absence {
  readonly id: AbsenceId;
  readonly personId: PersonId;
  readonly type: AbsenceType;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly source: AbsenceSource;
  readonly importBatchId?: string;
  /** Для обнаружения записей, исчезнувших из очередной выгрузки. */
  readonly lastSeenInImportAt?: IsoInstant;
  readonly syncedToHrAt?: IsoInstant;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Comp day
// ---------------------------------------------------------------------------

/** Терминального статуса «сгорел» нет: отгулы не сгорают (ADR-0007). */
export type CompDayStatus =
  | 'PROPOSED'
  | 'SCHEDULED'
  | 'TAKEN'
  | 'DECLINED'
  | 'PENDING_APPROVAL';

export interface CompDayEntry {
  readonly id: CompDayEntryId;
  readonly personId: PersonId;
  readonly earnedForAssignmentId: AssignmentId;
  readonly earnedForDate: IsoDate;
  readonly trigger: CompDayTrigger;
  /** Самая ранняя свободная подходящая дата в окне политики. */
  readonly proposedDate?: IsoDate;
  readonly actualDate?: IsoDate;
  readonly status: CompDayStatus;
  readonly syncedToHrAt?: IsoInstant;
}

/** Дата, на которую отгул реально приходится. */
export function effectiveCompDayDate(entry: CompDayEntry): IsoDate | undefined {
  return entry.actualDate ?? entry.proposedDate;
}

/** Блокирует ли отгул назначение. `PROPOSED` — только предложение системы. */
export function compDayBlocksAssignment(entry: CompDayEntry): boolean {
  return entry.status === 'SCHEDULED' || entry.status === 'TAKEN';
}

/** Числится ли отгул за человеком: ни отгулян, ни отклонён. */
export function compDayIsOutstanding(entry: CompDayEntry): boolean {
  return (
    entry.status === 'PROPOSED' ||
    entry.status === 'SCHEDULED' ||
    entry.status === 'PENDING_APPROVAL'
  );
}

// ---------------------------------------------------------------------------
// Покрытие
// ---------------------------------------------------------------------------

/**
 * `THIN` — минимум закрыт впритык, без запаса. Отдельное состояние, а не
 * оттенок зелёного: это самый действенный сигнал для планировщика.
 * `min = 0` всегда даёт `OK` — легальное «без обязательства покрытия»
 * (Service Transition), никогда не `GAP`/`THIN`.
 */
export type CoverageLevel = 'GAP' | 'THIN' | 'OK' | 'OVER';

export interface CoverageCell {
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly shiftId: ShiftId;
  readonly actual: number;
  readonly min: number;
  readonly max?: number;
  readonly level: CoverageLevel;
  readonly appliedKey: DayConfigKey;
  readonly ruleLabel?: string;
}

export interface CoverageSnapshot {
  readonly date: IsoDate;
  readonly unitId: UnitId;
  readonly cells: readonly CoverageCell[];
  readonly headcount: number;
  readonly totalRequired: number;
  readonly totalFilled: number;
}

// ---------------------------------------------------------------------------
// Лимиты одновременных отсутствий
// ---------------------------------------------------------------------------

export type AbsenceCapacityScope =
  | { readonly kind: 'UNIT' }
  | { readonly kind: 'SHIFT_POOL'; readonly shiftId: ShiftId };

export type AbsenceDurationBucket = 'SHORT' | 'LONG';

/** Лимит по пулу смен важнее общего — ADR-0010. */
export interface AbsenceCapacityRule {
  readonly id: string;
  readonly unitId: UnitId;
  readonly scope: AbsenceCapacityScope;
  readonly durationBucket: AbsenceDurationBucket;
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsTypes: readonly AbsenceType[];
  /** Учитывать ли подтверждённые отгулы наравне с отпуском. */
  readonly countsCompDays: boolean;
}

// ---------------------------------------------------------------------------
// Валидация
// ---------------------------------------------------------------------------

export type IssueLevel = 'BLOCKING' | 'WARNING' | 'INFO';

/**
 * Дыра — не сделана работа. Конфликт — записаны невозможные данные.
 * Чинятся по-разному и в интерфейсе не смешиваются.
 */
export type IssueCategory = 'GAP' | 'CONFLICT' | 'FAIRNESS' | 'POLICY';

export type IssueCode =
  | 'COVERAGE_GAP'
  | 'COVERAGE_THIN'
  | 'COVERAGE_OVER_MAX'
  | 'ASSIGNED_DURING_ABSENCE'
  | 'ASSIGNED_DURING_COMP_DAY'
  | 'DOUBLE_ASSIGNMENT'
  | 'SHIFT_NOT_ELIGIBLE'
  | 'SHIFT_OUTSIDE_REGION'
  | 'SHIFT_NOT_IN_DAY_CONFIG'
  | 'ABSENCE_CAPACITY_EXCEEDED'
  | 'MIN_REST_VIOLATED'
  | 'CONSECUTIVE_DAYS_EXCEEDED'
  | 'WEEKEND_LOAD_EXCEEDED'
  | 'UNAVAILABLE_WEEKDAY'
  | 'PREFERENCE_VIOLATED'
  | 'TARGET_SHARE_DEVIATION'
  | 'COMP_DAY_AGING'
  | 'COMP_DAY_PENDING_APPROVAL';

export interface Issue {
  /** Стабильный между пересчётами: по нему находится подтверждение. */
  readonly key: string;
  readonly level: IssueLevel;
  readonly category: IssueCategory;
  readonly code: IssueCode;
  readonly message: string;
  readonly unitId: UnitId;
  readonly date?: IsoDate;
  readonly personId?: PersonId;
  readonly shiftId?: ShiftId;
}

/** Осознанное подтверждение WARNING. Хранится вместе с планом. */
export interface Acknowledgement {
  readonly issueKey: string;
  readonly comment: string;
  readonly byPersonId: PersonId;
  readonly at: IsoInstant;
}

// ---------------------------------------------------------------------------
// Черновик и публикация
// ---------------------------------------------------------------------------

export type DraftStatus = 'OPEN' | 'PUBLISHED' | 'DISCARDED';

export interface DraftSession {
  readonly id: DraftSessionId;
  readonly editorPersonId: PersonId;
  readonly unitId: UnitId;
  readonly range: DateRange;
  readonly status: DraftStatus;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

export type DraftOp = 'CREATE' | 'UPDATE' | 'DELETE';
export type DraftTargetType = 'ASSIGNMENT' | 'ABSENCE' | 'COMP_DAY';

/**
 * Каждое изменение несёт и предыдущее, и новое значение — отсюда undo/redo
 * и экран сравнения при конфликте публикации.
 */
export type DraftChange =
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'ASSIGNMENT';
      readonly op: DraftOp;
      readonly before: Assignment | null;
      readonly after: Assignment | null;
    }
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'ABSENCE';
      readonly op: DraftOp;
      readonly before: Absence | null;
      readonly after: Absence | null;
    }
  | {
      readonly id: string;
      readonly seq: number;
      readonly at: IsoInstant;
      readonly targetType: 'COMP_DAY';
      readonly op: DraftOp;
      readonly before: CompDayEntry | null;
      readonly after: CompDayEntry | null;
    };

export interface PublishResult {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly compDaysGenerated: number;
  readonly remainingGaps: number;
}

/**
 * Расхождение опубликованного и черновика при устаревшей версии.
 *
 * Только `ASSIGNMENT` версионируется сегодня (ADR-0015 detectConflicts), но
 * тип шире намеренно — absence/comp-day конфликты появятся на бэкенде без
 * очередной правки этого интерфейса.
 */
export interface PublishConflict {
  readonly changeId: string;
  readonly targetType: DraftTargetType;
  readonly published: Assignment | Absence | CompDayEntry | null;
  readonly draft: Assignment | Absence | CompDayEntry | null;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Аудит
// ---------------------------------------------------------------------------

export type HistoryAction = 'CREATED' | 'UPDATED' | 'DELETED';

/** Append-only. Единственный контроль там, где нет ограничений прав. */
export interface AssignmentHistoryEntry {
  readonly id: string;
  readonly assignmentId: AssignmentId;
  readonly action: HistoryAction;
  readonly snapshot: Assignment | null;
  readonly actorId: PersonId;
  readonly at: IsoInstant;
}

// ---------------------------------------------------------------------------
// Проекция ячейки
// ---------------------------------------------------------------------------

export type CellStatus =
  | 'OFF'
  | 'NOT_SCHEDULED'
  | 'PH'
  | 'COMP_OFF'
  | 'VACATION'
  | 'SICK'
  | 'OTHER';

/**
 * Что показывает сетка для пары (человек, дата). Приоритет разрешается в
 * одном месте — `engine/cellValue.ts` — и больше нигде.
 */
export type CellValue =
  | {
      readonly kind: 'SHIFT';
      readonly shiftId: ShiftId;
      readonly assignmentId: AssignmentId;
      /** Предложенный, ещё не подтверждённый отгул на этот день. */
      readonly proposedCompDay?: CompDayEntryId;
      /** Назначение поверх отсутствия, отгула или праздника. */
      readonly conflict?: CellConflict;
    }
  | {
      readonly kind: 'STATUS';
      readonly status: CellStatus;
      readonly absenceId?: AbsenceId;
      readonly compDayId?: CompDayEntryId;
      readonly assignmentId?: AssignmentId;
    }
  | {
      readonly kind: 'EMPTY';
      readonly proposedCompDay?: CompDayEntryId;
    };

export type CellConflict = 'ABSENCE' | 'COMP_DAY' | 'HOLIDAY';

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

/** Справочная часть: меняется в настройках, не при планировании. */
export interface ReferenceData {
  readonly locations: readonly Location[];
  readonly holidays: readonly Holiday[];
  readonly units: readonly PlanningUnit[];
  readonly shifts: readonly Shift[];
  readonly dayConfigurations: readonly DayConfiguration[];
  readonly people: readonly Person[];
  readonly absenceCapacityRules: readonly AbsenceCapacityRule[];
}

/** Опубликованный план: то, что видят все. */
export interface PlanData {
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly acknowledgements: readonly Acknowledgement[];
}

export interface ScheduleDataset extends ReferenceData, PlanData {
  readonly history: readonly AssignmentHistoryEntry[];
}
