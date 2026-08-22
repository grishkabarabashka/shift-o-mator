/**
 * Реализация `ScheduleRepository` в памяти с персистом в IndexedDB.
 *
 * MVP-заглушка вместо бэкенда: данные живут в браузере, переживают
 * перезагрузку и выгружаются в JSON. Контракт при этом настоящий — когда
 * появится .NET API, поменяется только эта реализация (ADR-0012).
 *
 * Публикация здесь эмулирует серверную транзакцию: проверка версий, атомарное
 * применение, запись истории. Конкурентность в одной вкладке недостижима, но
 * контракт должен быть тот же, иначе интерфейс окажется написан не под него.
 */

import { del, get, set } from 'idb-keyval';
import { applyChanges } from '../domain/draft.ts';
import { createFixtureDataset } from '../domain/fixtures.ts';
import type {
  Assignment,
  AssignmentHistoryEntry,
  DateRange,
  DraftChange,
  DraftSession,
  DraftSessionId,
  PersonId,
  PlanData,
  PublishConflict,
  ReferenceData,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';
import { rangesOverlap } from '../engine/dates.ts';
import type { DraftBundle, PublishOutcome, ScheduleRepository } from './repository.ts';

const STORAGE_KEY = 'shift-o-mator/dataset/v2';

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

let sessionSeq = 0;
let historySeq = 0;

export class MemoryScheduleRepository implements ScheduleRepository {
  private data: ScheduleDataset;
  private readonly sessions = new Map<DraftSessionId, DraftSession>();
  private readonly changes = new Map<DraftSessionId, DraftChange[]>();
  private readonly latencyMs: number;
  private readonly persist: boolean;
  private hydrated: Promise<void> | undefined;

  constructor(options: MemoryRepositoryOptions = {}) {
    this.data = options.initial ?? createFixtureDataset();
    this.latencyMs = options.latencyMs ?? 0;
    this.persist = options.persist ?? true;
  }

  // -------------------------------------------------------------------------
  // Чтение
  // -------------------------------------------------------------------------

  async loadReference(): Promise<ReferenceData> {
    await this.ready();
    const {
      locations,
      holidays,
      regions,
      units,
      shifts,
      roles,
      dayConfigurations,
      people,
      absenceCapacityRules,
    } = this.data;
    return clone({
      locations,
      holidays,
      regions,
      units,
      shifts,
      roles,
      dayConfigurations,
      people,
      absenceCapacityRules,
    });
  }

  async loadPublished(unitId: UnitId, range: DateRange): Promise<PlanData> {
    await this.ready();
    return clone(this.selectPlan(unitId, range));
  }

  /**
   * Люди берутся по **региону**, а не по единице: покрытие считается по
   * региону, и дыра в чужой единице должна быть видна (ADR-0020).
   */
  private regionPeopleIds(unitId: UnitId): Set<PersonId> {
    const unit = this.data.units.find((u) => u.id === unitId);
    const regionIds = new Set<string>();
    if (unit?.kind === 'REGION' && unit.regionId) {
      regionIds.add(unit.regionId);
    } else {
      // Кросс-региональная единица касается всех регионов своих людей.
      for (const person of this.data.people) {
        if (person.unitId === unitId) regionIds.add(person.regionId);
      }
    }
    return new Set(
      this.data.people.filter((p) => regionIds.has(p.regionId)).map((p) => p.id),
    );
  }

  private selectPlan(unitId: UnitId, range: DateRange): PlanData {
    const visible = this.regionPeopleIds(unitId);
    return {
      assignments: this.data.assignments.filter(
        (a) => visible.has(a.personId) && a.date >= range.from && a.date <= range.to,
      ),
      // Отпуск, начавшийся до периода, всё равно блокирует дни внутри него.
      absences: this.data.absences.filter(
        (a) => visible.has(a.personId) && rangesOverlap({ from: a.from, to: a.to }, range),
      ),
      compDays: this.data.compDays.filter((entry) => visible.has(entry.personId)),
      acknowledgements: this.data.acknowledgements,
    };
  }

  // -------------------------------------------------------------------------
  // Черновики — ADR-0015
  // -------------------------------------------------------------------------

  async openDraft(
    unitId: UnitId,
    range: DateRange,
    editorId: PersonId,
  ): Promise<DraftBundle> {
    await this.ready();
    const existing = [...this.sessions.values()].find(
      (session) =>
        session.status === 'OPEN' &&
        session.unitId === unitId &&
        session.editorPersonId === editorId &&
        rangesOverlap(session.range, range),
    );
    if (existing) return this.bundle(existing.id);

    sessionSeq += 1;
    const now = new Date().toISOString();
    const session: DraftSession = {
      id: `draft-${Date.now().toString(36)}-${sessionSeq}`,
      editorPersonId: editorId,
      unitId,
      range,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    this.changes.set(session.id, []);
    return this.bundle(session.id);
  }

  async getDraft(sessionId: DraftSessionId): Promise<DraftBundle | undefined> {
    await this.ready();
    return this.sessions.has(sessionId) ? this.bundle(sessionId) : undefined;
  }

  async appendChanges(
    sessionId: DraftSessionId,
    incoming: readonly DraftChange[],
  ): Promise<DraftBundle> {
    await this.ready();
    const session = this.requireOpen(sessionId);
    const existing = this.changes.get(sessionId) ?? [];
    this.changes.set(sessionId, [...existing, ...incoming]);
    this.touch(session);
    return this.bundle(sessionId);
  }

  async removeChanges(
    sessionId: DraftSessionId,
    changeIds: readonly string[],
  ): Promise<DraftBundle> {
    await this.ready();
    const session = this.requireOpen(sessionId);
    const drop = new Set(changeIds);
    const existing = this.changes.get(sessionId) ?? [];
    this.changes.set(
      sessionId,
      existing.filter((change) => !drop.has(change.id)),
    );
    this.touch(session);
    return this.bundle(sessionId);
  }

  /**
   * Атомарная публикация: сначала полная проверка версий, и только потом
   * запись. Частично применённый черновик хуже отклонённого.
   */
  async publishDraft(sessionId: DraftSessionId): Promise<PublishOutcome> {
    await this.ready();
    const session = this.requireOpen(sessionId);
    const changes = [...(this.changes.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq);

    const conflicts = this.detectConflicts(changes);
    if (conflicts.length > 0) return { ok: false, conflicts };

    const before = {
      assignments: this.data.assignments,
      absences: this.data.absences,
      compDays: this.data.compDays,
      acknowledgements: this.data.acknowledgements,
    };
    const after = applyChanges(before, changes);

    const history: AssignmentHistoryEntry[] = [];
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let compDaysGenerated = 0;

    const now = new Date().toISOString();
    for (const change of changes) {
      if (change.targetType === 'COMP_DAY') {
        if (change.op === 'CREATE') compDaysGenerated += 1;
        continue;
      }
      if (change.targetType !== 'ASSIGNMENT') continue;
      if (change.op === 'CREATE') created += 1;
      else if (change.op === 'UPDATE') updated += 1;
      else deleted += 1;

      const target = change.after ?? change.before;
      if (!target) continue;
      historySeq += 1;
      history.push({
        id: `hist-${Date.now().toString(36)}-${historySeq}`,
        assignmentId: target.id,
        action: change.op === 'CREATE' ? 'CREATED' : change.op === 'UPDATE' ? 'UPDATED' : 'DELETED',
        snapshot: change.after,
        actorId: session.editorPersonId,
        at: now,
      });
    }

    // Версия растёт только у переживших публикацию назначений.
    const bumped = after.assignments.map((assignment) =>
      before.assignments.some((a) => a.id === assignment.id && a.version === assignment.version)
        ? { ...assignment, version: assignment.version + 1, updatedAt: now }
        : assignment,
    );

    this.data = {
      ...this.data,
      ...after,
      assignments: bumped,
      history: [...this.data.history, ...history],
    };
    this.sessions.set(sessionId, { ...session, status: 'PUBLISHED', updatedAt: now });
    await this.flush();

    return {
      ok: true,
      result: { created, updated, deleted, compDaysGenerated, remainingGaps: 0 },
    };
  }

  /**
   * Устаревшая правка: опубликованная запись изменилась с тех пор, как
   * планировщик взял её в черновик.
   */
  private detectConflicts(changes: readonly DraftChange[]): PublishConflict[] {
    const conflicts: PublishConflict[] = [];
    const published = new Map<string, Assignment>();
    for (const assignment of this.data.assignments) published.set(assignment.id, assignment);

    for (const change of changes) {
      if (change.targetType !== 'ASSIGNMENT' || change.before === null) continue;
      const current = published.get(change.before.id);
      if (!current) {
        conflicts.push({
          changeId: change.id,
          targetType: 'ASSIGNMENT',
          published: null,
          draft: change.after,
          reason: 'The assignment was removed by someone else',
        });
        continue;
      }
      if (current.version !== change.before.version) {
        conflicts.push({
          changeId: change.id,
          targetType: 'ASSIGNMENT',
          published: current,
          draft: change.after,
          reason: 'The assignment changed after this draft was started',
        });
      }
    }
    return conflicts;
  }

  async discardDraft(sessionId: DraftSessionId): Promise<void> {
    await this.ready();
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // Сессия остаётся для аудита.
    this.sessions.set(sessionId, {
      ...session,
      status: 'DISCARDED',
      updatedAt: new Date().toISOString(),
    });
  }

  async listOverlappingDrafts(
    unitId: UnitId,
    range: DateRange,
    excludeEditorId: PersonId,
  ): Promise<readonly DraftSession[]> {
    await this.ready();
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.status === 'OPEN' &&
          session.unitId === unitId &&
          session.editorPersonId !== excludeEditorId &&
          rangesOverlap(session.range, range),
      )
      .map(clone);
  }

  private bundle(sessionId: DraftSessionId): DraftBundle {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Draft session ${sessionId} not found`);
    return clone({ session, changes: this.changes.get(sessionId) ?? [] });
  }

  private requireOpen(sessionId: DraftSessionId): DraftSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Draft session ${sessionId} not found`);
    if (session.status !== 'OPEN') throw new Error(`Draft session ${sessionId} is not open`);
    return session;
  }

  private touch(session: DraftSession): void {
    this.sessions.set(session.id, { ...session, updatedAt: new Date().toISOString() });
  }

  // -------------------------------------------------------------------------
  // Аудит, импорт, экспорт
  // -------------------------------------------------------------------------

  async history(range: DateRange): Promise<readonly AssignmentHistoryEntry[]> {
    await this.ready();
    const from = `${range.from}T00:00:00Z`;
    const to = `${range.to}T23:59:59Z`;
    return this.data.history.filter((entry) => entry.at >= from && entry.at <= to).map(clone);
  }

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
    if (!isDataset(parsed)) throw new Error('This file does not look like shift-o-mator state');
    this.data = parsed;
    this.sessions.clear();
    this.changes.clear();
    await this.flush();
  }

  async reset(): Promise<void> {
    this.data = createFixtureDataset();
    this.sessions.clear();
    this.changes.clear();
    if (this.persist) {
      try {
        // `del` бросает синхронно, когда IndexedDB нет вовсе, — до того как
        // вернёт промис, так что `.catch()` тут не помог бы.
        await del(STORAGE_KEY);
      } catch {
        // Хранилище недоступно (приватный режим, тесты) — не повод падать.
      }
    }
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
    Array.isArray(candidate.regions) &&
    Array.isArray(candidate.units) &&
    Array.isArray(candidate.dayConfigurations) &&
    Array.isArray(candidate.assignments)
  );
}

/** Репозиторий приложения. Единственный экземпляр на вкладку. */
export const scheduleRepository: ScheduleRepository = new MemoryScheduleRepository();
