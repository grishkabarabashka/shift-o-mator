/**
 * Единственная граница данных — ADR-0012.
 *
 * Ни один компонент и ни одна функция движка не обращается к хранилищу мимо
 * этого интерфейса. В MVP реализация in-memory с персистом в IndexedDB, позже
 * та же сигнатура ложится на .NET-эндпоинты.
 *
 * Все методы асинхронные с самого начала, даже когда данные локальные. Иначе
 * при появлении сети всплывут все места, где код рассчитывал на синхронность.
 */

import type { Patch } from '../domain/patch.ts';
import type {
  DateRange,
  PeriodLock,
  PersonId,
  PlanData,
  ReferenceData,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';

/** Результат попытки взять период в работу. */
export type LockResult =
  | { readonly ok: true; readonly lock: PeriodLock }
  | { readonly ok: false; readonly heldBy: PeriodLock };

export interface ScheduleRepository {
  /** Справочная часть: локации, роли, люди, правила. */
  loadReference(): Promise<ReferenceData>;

  /** Планируемая часть за период. Загружается целиком: масштаб позволяет. */
  loadPlan(unitId: UnitId, range: DateRange): Promise<PlanData>;

  /**
   * Сохранение батчем. Возвращает состояние после применения — на случай, если
   * сервер что-то досчитал (например, начисления comp days).
   */
  savePatches(unitId: UnitId, range: DateRange, patches: readonly Patch[]): Promise<PlanData>;

  getLock(unitId: UnitId, range: DateRange): Promise<PeriodLock | undefined>;
  acquireLock(unitId: UnitId, range: DateRange, byPersonId: PersonId): Promise<LockResult>;
  releaseLock(unitId: UnitId, range: DateRange, byPersonId: PersonId): Promise<void>;

  /** Полное состояние в JSON — для отладки и переноса данных из MVP. */
  exportJson(): Promise<string>;
  importJson(json: string): Promise<void>;
  /** Вернуться к фикстурам. */
  reset(): Promise<void>;

  /** Снимок целиком. Нужен экспорту и тестам, в проде уйдёт. */
  snapshot(): Promise<ScheduleDataset>;
}
