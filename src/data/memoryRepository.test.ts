import { beforeEach, describe, expect, it } from 'vitest';
import { assignmentChange } from '../domain/draft.ts';
import { buildIndex } from '../domain/lookup.ts';
import type { Acknowledgement, Assignment, DraftChange } from '../domain/types.ts';
import { computeCoverage } from '../engine/coverage.ts';
import { MemoryScheduleRepository } from './memoryRepository.ts';

const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;
const UNIT = 'unit-amer';
const ST_UNIT = 'unit-st';
const EDITOR = 'p-editor';
const AT = '2026-08-01T10:00:00Z';

function repo(): MemoryScheduleRepository {
  return new MemoryScheduleRepository({ persist: false });
}

async function firstAssignment(r: MemoryScheduleRepository): Promise<Assignment> {
  const plan = await r.loadPublished(UNIT, RANGE);
  const assignment = plan.assignments[0];
  if (!assignment) throw new Error('Fixtures have no assignments in range');
  return assignment;
}

describe('загрузка', () => {
  it('отдаёт справочник целиком', async () => {
    const reference = await repo().loadReference();
    expect(reference.regions).toHaveLength(3);
    expect(reference.units).toHaveLength(4);
    expect(reference.people.length).toBeGreaterThan(70);
    expect(reference.dayConfigurations.length).toBeGreaterThan(0);
    expect(reference.shifts.length).toBeGreaterThan(0);
  });

  it('роли принадлежат региону, а не единице', async () => {
    const reference = await repo().loadReference();
    expect(reference.roles.every((role) => ['AMER', 'EMEA', 'APAC'].includes(role.regionId))).toBe(
      true,
    );
  });

  it('план ограничен периодом', async () => {
    const plan = await repo().loadPublished(UNIT, RANGE);
    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(
      plan.assignments.every((a) => a.date >= RANGE.from && a.date <= RANGE.to),
    ).toBe(true);
  });

  it('план берётся по региону, а не по единице', async () => {
    // Люди ST сидят в регионах AMER/EMEA/APAC; их назначения должны быть
    // видны из региональной единицы, иначе дыру по ST Amer не починить.
    const r = repo();
    const reference = await r.loadReference();
    const plan = await r.loadPublished(UNIT, RANGE);

    const stInAmer = reference.people.filter(
      (p) => p.unitId === ST_UNIT && p.regionId === 'AMER',
    );
    expect(stInAmer.length).toBeGreaterThan(0);

    const visible = new Set(plan.assignments.map((a) => a.personId));
    const anyStVisible = stInAmer.some((p) => visible.has(p.id));
    expect(anyStVisible).toBe(true);
  });

  it('отдаёт отпуска, начавшиеся до периода', async () => {
    const plan = await repo().loadPublished(UNIT, { from: '2026-08-10', to: '2026-08-12' });
    expect(plan.absences.every((a) => a.to >= '2026-08-10' && a.from <= '2026-08-12')).toBe(true);
  });
});

describe('черновики', () => {
  let r: MemoryScheduleRepository;

  beforeEach(() => {
    r = repo();
  });

  it('повторный запрос возвращает тот же открытый черновик', async () => {
    const first = await r.openDraft(UNIT, RANGE, EDITOR);
    const second = await r.openDraft(UNIT, RANGE, EDITOR);
    expect(second.session.id).toBe(first.session.id);
  });

  it('разные редакторы получают разные черновики на тот же период', async () => {
    const mine = await r.openDraft(UNIT, RANGE, EDITOR);
    const theirs = await r.openDraft(UNIT, RANGE, 'p-other');
    expect(theirs.session.id).not.toBe(mine.session.id);
  });

  it('чужой пересекающийся черновик виден для баннера', async () => {
    await r.openDraft(UNIT, RANGE, 'p-other');
    const overlapping = await r.listOverlappingDrafts(UNIT, RANGE, EDITOR);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0]?.editorPersonId).toBe('p-other');
  });

  it('свой черновик в список чужих не попадает', async () => {
    await r.openDraft(UNIT, RANGE, EDITOR);
    expect(await r.listOverlappingDrafts(UNIT, RANGE, EDITOR)).toHaveLength(0);
  });

  it('непересекающийся период чужим не считается', async () => {
    await r.openDraft(UNIT, { from: '2026-10-01', to: '2026-10-31' }, 'p-other');
    expect(await r.listOverlappingDrafts(UNIT, RANGE, EDITOR)).toHaveLength(0);
  });

  it('изменения копятся и удаляются', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    const existing = await firstAssignment(r);
    const change = assignmentChange(existing, null, 0, AT);

    const withChange = await r.appendChanges(draft.session.id, [change]);
    expect(withChange.changes).toHaveLength(1);

    const cleared = await r.removeChanges(draft.session.id, [change.id]);
    expect(cleared.changes).toHaveLength(0);
  });

  it('черновик не виден в опубликованных данных до публикации', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    const existing = await firstAssignment(r);
    await r.appendChanges(draft.session.id, [assignmentChange(existing, null, 0, AT)]);

    const published = await r.loadPublished(UNIT, RANGE);
    expect(published.assignments.some((a) => a.id === existing.id)).toBe(true);
  });

  it('отклонённая сессия сохраняется для аудита', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    await r.discardDraft(draft.session.id);
    const after = await r.getDraft(draft.session.id);
    expect(after?.session.status).toBe('DISCARDED');
  });
});

describe('публикация', () => {
  let r: MemoryScheduleRepository;

  beforeEach(() => {
    r = repo();
  });

  it('применяет изменения атомарно и поднимает версию', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    const existing = await firstAssignment(r);
    const moved: Assignment = { ...existing, note: 'reassigned' };
    await r.appendChanges(draft.session.id, [assignmentChange(existing, moved, 0, AT)]);

    const outcome = await r.publishDraft(draft.session.id);
    expect(outcome.ok).toBe(true);

    const published = await r.loadPublished(UNIT, RANGE);
    const updated = published.assignments.find((a) => a.id === existing.id);
    expect(updated?.note).toBe('reassigned');
    expect(updated?.version).toBe(existing.version + 1);
  });

  it('пишет историю', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    const existing = await firstAssignment(r);
    await r.appendChanges(draft.session.id, [assignmentChange(existing, null, 0, AT)]);
    await r.publishDraft(draft.session.id);

    const history = await r.history({ from: '2020-01-01', to: '2030-12-31' });
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe('DELETED');
    expect(history[0]?.actorId).toBe(EDITOR);
  });

  it('сессия становится PUBLISHED', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    await r.publishDraft(draft.session.id);
    expect((await r.getDraft(draft.session.id))?.session.status).toBe('PUBLISHED');
  });

  it('устаревшая версия даёт конфликт, а не перезапись', async () => {
    const existing = await firstAssignment(r);

    // Первый планировщик публикует правку.
    const first = await r.openDraft(UNIT, RANGE, 'p-first');
    await r.appendChanges(first.session.id, [
      assignmentChange(existing, { ...existing, note: 'first' }, 0, AT),
    ]);
    await r.publishDraft(first.session.id);

    // Второй начал раньше и держит устаревшую версию.
    const second = await r.openDraft(UNIT, RANGE, 'p-second');
    await r.appendChanges(second.session.id, [
      assignmentChange(existing, { ...existing, note: 'second' }, 0, AT),
    ]);
    const outcome = await r.publishDraft(second.session.id);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.conflicts).toHaveLength(1);
      expect(outcome.conflicts[0]?.reason).toContain('changed after');
    }

    // Опубликованное значение осталось от первого.
    const published = await r.loadPublished(UNIT, RANGE);
    expect(published.assignments.find((a) => a.id === existing.id)?.note).toBe('first');
  });

  it('провал публикации сохраняет черновик целиком', async () => {
    const existing = await firstAssignment(r);
    const first = await r.openDraft(UNIT, RANGE, 'p-first');
    await r.appendChanges(first.session.id, [
      assignmentChange(existing, { ...existing, note: 'first' }, 0, AT),
    ]);
    await r.publishDraft(first.session.id);

    const second = await r.openDraft(UNIT, RANGE, 'p-second');
    const changes: DraftChange[] = [
      assignmentChange(existing, { ...existing, note: 'second' }, 0, AT),
    ];
    await r.appendChanges(second.session.id, changes);
    await r.publishDraft(second.session.id);

    const after = await r.getDraft(second.session.id);
    expect(after?.session.status).toBe('OPEN');
    expect(after?.changes).toHaveLength(1);
  });

  it('remainingGaps считает дыры по факту опубликованного покрытия, не заглушкой', async () => {
    const draft = await r.openDraft(UNIT, RANGE, EDITOR);
    const existing = await firstAssignment(r);
    await r.appendChanges(draft.session.id, [assignmentChange(existing, null, 0, AT)]);

    const outcome = await r.publishDraft(draft.session.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const dataset = await r.snapshot();
    const index = buildIndex(dataset);
    const expectedGaps = computeCoverage({
      regionId: existing.regionId,
      range: RANGE,
      assignments: dataset.assignments,
      index,
    }).filter((cell) => cell.level === 'GAP').length;

    expect(outcome.result.remainingGaps).toBe(expectedGaps);
  });
});

describe('подтверждения нарушений', () => {
  it('переживают повторную загрузку, а не только текущую сессию', async () => {
    const r = repo();
    const ack: Acknowledgement = {
      issueKey: 'gap:AMER:2026-08-10:Lead',
      comment: 'Covered by an authorized override',
      byPersonId: EDITOR,
      at: AT,
    };
    await r.saveAcknowledgement(ack);

    const plan = await r.loadPublished(UNIT, RANGE);
    expect(plan.acknowledgements).toContainEqual(ack);
  });

  it('повторное подтверждение той же дыры заменяет прежнюю запись', async () => {
    const r = repo();
    const issueKey = 'gap:AMER:2026-08-10:Lead';
    await r.saveAcknowledgement({ issueKey, comment: 'first', byPersonId: EDITOR, at: AT });
    await r.saveAcknowledgement({ issueKey, comment: 'second', byPersonId: EDITOR, at: AT });

    const plan = await r.loadPublished(UNIT, RANGE);
    const matching = plan.acknowledgements.filter((a) => a.issueKey === issueKey);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.comment).toBe('second');
  });
});

describe('экспорт и импорт', () => {
  it('состояние переживает круг через JSON', async () => {
    const source = repo();
    const json = await source.exportJson();

    const target = new MemoryScheduleRepository({ persist: false });
    await target.importJson(json);

    expect((await target.loadPublished(UNIT, RANGE)).assignments).toEqual(
      (await source.loadPublished(UNIT, RANGE)).assignments,
    );
  });

  it('чужой JSON отвергается', async () => {
    await expect(repo().importJson('{"foo":1}')).rejects.toThrow(/does not look like/);
  });
});
