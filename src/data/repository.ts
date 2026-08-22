/**
 * Единственная граница данных — ADR-0012.
 *
 * Ни один компонент и ни одна функция движка не обращается к хранилищу мимо
 * этого интерфейса. В MVP реализация in-memory с персистом в IndexedDB, позже
 * та же сигнатура ложится на .NET-эндпоинты.
 *
 * Все методы асинхронные с самого начала, даже когда данные локальные. Иначе
 * при появлении сети всплывут все места, где код рассчитывал на синхронность.
 *
 * Опубликованные назначения **не пишутся напрямую** (ADR-0015): всё проходит
 * через черновик и публикацию.
 */

import type { DraftChange } from '../domain/types.ts';
import type {
  Acknowledgement,
  AssignmentHistoryEntry,
  DateRange,
  DraftSession,
  DraftSessionId,
  Person,
  PersonId,
  PlanData,
  PublishConflict,
  PublishResult,
  ReferenceData,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';

/** Результат публикации: успех или список расхождений. */
export type PublishOutcome =
  | { readonly ok: true; readonly result: PublishResult }
  | { readonly ok: false; readonly conflicts: readonly PublishConflict[] };

/** Черновик со своими изменениями. */
export interface DraftBundle {
  readonly session: DraftSession;
  readonly changes: readonly DraftChange[];
}

export interface ScheduleRepository {
  /** Справочная часть: регионы, единицы, локации, смены, роли, конфигурации, люди. */
  loadReference(): Promise<ReferenceData>;

  /**
   * Опубликованный план за период. Ограничен регионами, которые видны в
   * единице: покрытие считается по региону, поэтому нужны все его люди.
   */
  loadPublished(unitId: UnitId, range: DateRange): Promise<PlanData>;

  /**
   * Профиль человека: eligibility с целевыми долями, доступные дни, пожелания.
   *
   * Идёт **мимо черновика** намеренно. Черновик — про план на период
   * (ADR-0015); «Priya берёт треть Batch-L» — это не правка расписания, а
   * настройка, которую читает автогенерация. Пропустив её через публикацию,
   * мы связали бы изменение профиля с выпуском конкретного месяца.
   */
  savePerson(person: Person): Promise<Person>;

  /**
   * Подтверждение нарушения — тоже мимо черновика (как и `savePerson`), но по
   * другой причине: это оценка уже опубликованного плана, а не его правка.
   * Заменяет прежнюю запись с тем же `issueKey`, если она была.
   */
  saveAcknowledgement(ack: Acknowledgement): Promise<void>;

  // -- Черновики ------------------------------------------------------------

  /** Возвращает уже открытый черновик редактора или создаёт новый. */
  openDraft(unitId: UnitId, range: DateRange, editorId: PersonId): Promise<DraftBundle>;
  getDraft(sessionId: DraftSessionId): Promise<DraftBundle | undefined>;
  appendChanges(sessionId: DraftSessionId, changes: readonly DraftChange[]): Promise<DraftBundle>;
  /** Убирает изменения из черновика — используется undo. */
  removeChanges(sessionId: DraftSessionId, changeIds: readonly string[]): Promise<DraftBundle>;
  /** Атомарно применяет черновик к опубликованным данным. */
  publishDraft(sessionId: DraftSessionId): Promise<PublishOutcome>;
  /** Сессия сохраняется для аудита, а не удаляется. */
  discardDraft(sessionId: DraftSessionId): Promise<void>;
  /**
   * Чужие открытые черновики, пересекающиеся с периодом. Нужны для
   * информационного баннера — не для блокировки.
   */
  listOverlappingDrafts(
    unitId: UnitId,
    range: DateRange,
    excludeEditorId: PersonId,
  ): Promise<readonly DraftSession[]>;

  // -- Аудит и перенос ------------------------------------------------------

  history(range: DateRange): Promise<readonly AssignmentHistoryEntry[]>;

  /** Полное состояние в JSON — для отладки и переноса данных из MVP. */
  exportJson(): Promise<string>;
  importJson(json: string): Promise<void>;
  reset(): Promise<void>;
  snapshot(): Promise<ScheduleDataset>;
}
