/**
 * Реализация `ScheduleRepository` в памяти с персистом в IndexedDB.
 *
 * Это MVP-заглушка вместо бэкенда: данные живут в браузере, переживают
 * перезагрузку страницы и выгружаются в JSON. Контракт при этом настоящий —
 * когда появится .NET API, поменяется только эта реализация (ADR-0012).
 */

import { del, get, set } from 'idb-keyval';
import { createFixtureDataset } from '../domain/fixtures.ts';
import { applyPatches, type Patch } from '../domain/patch.ts';
import type {
  DateRange,
  PeriodLock,
  PersonId,
  PlanData,
  ReferenceData,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';
import { rangesOverlap } from '../engine/dates.ts';
import type { LockResult, ScheduleRepository } from './repository.ts';

const STORAGE_KEY = 'shift-o-mator/dataset/v1';

/** Через сколько минут неактивности блокировка снимается сама. */
export const LOCK_TIMEOUT_MINUTES = 30;

export interface MemoryRepositoryOptions {
  /** Искусственная задержка, чтобы интерфейс писался под реальную асинхронность. */
  readonly latencyMs?: number;
  /** Сохранять ли состояние в IndexedDB. В тестах выключается. */
  readonly persist?: boolean;
  readonly initial?: ScheduleDataset;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function rangeKey(unitId: UnitId, range: DateRange): string {
  return `${unitId}|${range.from}|${range.to}`;
}

export class MemoryScheduleRepository implements ScheduleRepository {
  private data: ScheduleDataset;
  private readonly locks = new Map<string, PeriodLock>();
  private readonly latencyMs: number;
  private readonly persist: boolean;
  private hydrated: Promise<void> | undefined;

  constructor(options: MemoryRepositoryOptions = {}) {
    this.data = options.initial ?? createFixtureDataset();
    this.latencyMs = options.latencyMs ?? 0;
    this.persist = options.persist ?? true;
  }

  // -------------------------------------------------------------------------
  // Справочник и план
  // -------------------------------------------------------------------------

  async loadReference(): Promise<ReferenceData> {
    await this.ready();
    const {
      locations,
      holidays,
      units,
      roles,
      people,
      coverageRules,
      absenceCapacityRules,
    } = this.data;
    return clone({
      locations,
      holidays,
      units,
      roles,
      people,
      coverageRules,
      absenceCapacityRules,
    });
  }

  async loadPlan(unitId: UnitId, range: DateRange): Promise<PlanData> {
    await this.ready();
    return clone(this.selectPlan(unitId, range));
  }

  async savePatches(
    unitId: UnitId,
    range: DateRange,
    patches: readonly Patch[],
  ): Promise<PlanData> {
    await this.ready();
    const plan: PlanData = {
      assignments: this.data.assignments,
      absences: this.data.absences,
      compDays: this.data.compDays,
      acknowledgements: this.data.acknowledgements,
    };
    const next = applyPatches(plan, patches);
    this.data = { ...this.data, ...next };
    await this.flush();
    return clone(this.selectPlan(unitId, range));
  }

  /**
   * План единицы за период. Отсутствия и отгулы берутся с запасом за границы:
   * отпуск, начавшийся до периода, всё равно блокирует назначения внутри него.
   */
  private selectPlan(unitId: UnitId, range: DateRange): PlanData {
    const unitPeople = new Set(
      this.data.people.filter((person) => person.unitId === unitId).map((person) => person.id),
    );

    return {
      assignments: this.data.assignments.filter(
        (assignment) =>
          unitPeople.has(assignment.personId) &&
          assignment.date >= range.from &&
          assignment.date <= range.to,
      ),
      absences: this.data.absences.filter(
        (absence) =>
          unitPeople.has(absence.personId) &&
          rangesOverlap({ from: absence.from, to: absence.to }, range),
      ),
      compDays: this.data.compDays.filter((entry) => unitPeople.has(entry.personId)),
      acknowledgements: this.data.acknowledgements,
    };
  }

  // -------------------------------------------------------------------------
  // Блокировка периода — ADR-0011
  // -------------------------------------------------------------------------

  async getLock(unitId: UnitId, range: DateRange): Promise<PeriodLock | undefined> {
    await this.ready();
    return this.activeLock(unitId, range);
  }

  async acquireLock(
    unitId: UnitId,
    range: DateRange,
    byPersonId: PersonId,
  ): Promise<LockResult> {
    await this.ready();
    const existing = this.activeLock(unitId, range);
    if (existing && existing.byPersonId !== byPersonId) {
      return { ok: false, heldBy: clone(existing) };
    }

    const now = new Date();
    const lock: PeriodLock = {
      unitId,
      range,
      byPersonId,
      acquiredAt: existing?.acquiredAt ?? now.toISOString(),
      expiresAt: new Date(now.getTime() + LOCK_TIMEOUT_MINUTES * 60_000).toISOString(),
    };
    this.locks.set(rangeKey(unitId, range), lock);
    return { ok: true, lock: clone(lock) };
  }

  async releaseLock(unitId: UnitId, range: DateRange, byPersonId: PersonId): Promise<void> {
    await this.ready();
    const key = rangeKey(unitId, range);
    const lock = this.locks.get(key);
    if (lock && lock.byPersonId === byPersonId) this.locks.delete(key);
  }

  /** Блокировка с учётом таймаута: истёкшая считается снятой. */
  private activeLock(unitId: UnitId, range: DateRange): PeriodLock | undefined {
    const now = new Date().toISOString();
    for (const lock of this.locks.values()) {
      if (lock.unitId !== unitId) continue;
      if (!rangesOverlap(lock.range, range)) continue;
      if (lock.expiresAt <= now) {
        this.locks.delete(rangeKey(lock.unitId, lock.range));
        continue;
      }
      return lock;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Импорт, экспорт, сброс
  // -------------------------------------------------------------------------

  async snapshot(): Promise<ScheduleDataset> {
    await this.ready();
    return clone(this.data);
  }

  async exportJson(): Promise<string> {
    await this.ready();
    return JSON.stringify(this.data, null, 2);
  }

  async importJson(json: string): Promise<void> {
    const parsed: unknown = JSON.parse(json);
    if (!isDataset(parsed)) throw new Error('Файл не похож на состояние shift-o-mator');
    this.data = parsed;
    this.locks.clear();
    await this.flush();
  }

  async reset(): Promise<void> {
    this.data = createFixtureDataset();
    this.locks.clear();
    if (this.persist) await del(STORAGE_KEY).catch(() => undefined);
    this.hydrated = Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Персист
  // -------------------------------------------------------------------------

  private ready(): Promise<void> {
    this.hydrated ??= this.hydrate();
    return this.hydrated;
  }

  private async hydrate(): Promise<void> {
    if (this.latencyMs > 0) await delay(this.latencyMs);
    if (!this.persist) return;
    try {
      const stored = await get<ScheduleDataset>(STORAGE_KEY);
      if (stored && isDataset(stored)) this.data = stored;
    } catch {
      // IndexedDB недоступен (приватный режим, тесты) — работаем в памяти.
    }
  }

  private async flush(): Promise<void> {
    if (!this.persist) return;
    try {
      await set(STORAGE_KEY, this.data);
    } catch {
      // Потеря персиста не должна ронять редактирование.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isDataset(value: unknown): value is ScheduleDataset {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ScheduleDataset>;
  return (
    Array.isArray(candidate.people) &&
    Array.isArray(candidate.roles) &&
    Array.isArray(candidate.units) &&
    Array.isArray(candidate.locations) &&
    Array.isArray(candidate.assignments)
  );
}

/** Репозиторий приложения. Единственный экземпляр на вкладку. */
export const scheduleRepository: ScheduleRepository = new MemoryScheduleRepository();
