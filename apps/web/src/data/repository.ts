/**
 * Единственная граница данных — ADR-0012.
 *
 * Ни один компонент и ни одна функция движка не обращается к хранилищу мимо
 * этого интерфейса. Phase 5: единственная реализация — `HttpScheduleRepository`
 * (`data/httpRepository.ts`) поверх .NET API; `MemoryScheduleRepository` и
 * IndexedDB-персист удалены вместе с фикстурами (ADR: HTTP cutover).
 *
 * Все методы асинхронные с самого начала, даже когда данные были локальными.
 * Иначе при появлении сети всплыли бы все места, где код рассчитывал на
 * синхронность.
 *
 * Опубликованные назначения **не пишутся напрямую** (ADR-0015): всё проходит
 * через черновик и публикацию.
 *
 * `exportJson`/`importJson`/`reset`/`snapshot` из MVP-версии интерфейса сняты
 * здесь: это были debug/test-удобства поверх in-memory реализации, у бэкенда
 * нет и не планируется соответствующих эндпоинтов (полный дамп датасета —
 * не операция, которую делает планировщик).
 */

import type { DraftChange } from '../domain/types.ts';
import type {
  Absence,
  Acknowledgement,
  Assignment,
  AssignmentHistoryEntry,
  CompDayEntry,
  DateRange,
  DraftSession,
  DraftSessionId,
  Person,
  PersonId,
  PlanData,
  PublishConflict,
  PublishResult,
  ReferenceData,
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

/**
 * Одна синхронизируемая единица черновика: «вот чем должна кончиться эта
 * ячейка», а не «вот какую операцию я сделал».
 *
 * Клиент больше не вычисляет op: раньше он выводил CREATE/UPDATE/DELETE из
 * своего локального состояния, и повторная покраска ячейки, созданной в этом
 * же черновике, уходила как UPDATE строки, которой в опубликованных данных
 * ещё нет — сервер отвечал 400, а вместе с ним терялся весь хвост батча.
 * Теперь op выводит сервер, сравнивая с опубликованным.
 *
 * `key` — то, о чём изменение: для назначения это ячейка `personId|date`
 * (в ячейке не бывает двух назначений), для отсутствия и отгула — id записи.
 */
export interface DraftSyncItem {
  readonly targetType: DraftChange['targetType'];
  readonly key: string;
  /** Желаемое состояние; `null` — ячейка должна остаться пустой. */
  readonly after: Assignment | Absence | CompDayEntry | null;
}

export interface ScheduleRepository {
  /** Справочная часть: единицы планирования, локации, смены, конфигурации, люди. */
  loadReference(): Promise<ReferenceData>;

  /** Опубликованный план за период для единицы планирования. */
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
  /**
   * Приводит черновик к состоянию, в котором находятся перечисленные ячейки:
   * на ключ остаётся ровно одно изменение, лишнее убирается. Идемпотентно —
   * повтор после сетевого сбоя (и undo, который тоже просто меняет состояние
   * ячейки) не требует отдельного «удалить изменение».
   */
  syncChanges(sessionId: DraftSessionId, items: readonly DraftSyncItem[]): Promise<DraftBundle>;
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
}
