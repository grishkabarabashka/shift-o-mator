import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makeDayConfig,
  makePerson,
  nightRole,
  testRegion,
  type DatasetOverrides,
} from '../domain/testkit.ts';
import type {
  Absence,
  AbsenceCapacityRule,
  CompDayEntry,
  DayConfiguration,
  Issue,
  IssueCode,
} from '../domain/types.ts';
import { computeCoverage } from './coverage.ts';
import { acknowledgedKeys, canPublish, summarizeIssues, validate } from './validate.ts';

const RANGE = { from: '2026-09-07', to: '2026-09-13' } as const;

const weekday: DayConfiguration = makeDayConfig({
  id: 'dc-weekday',
  key: 'weekday',
  weekdays: [1, 2, 3, 4, 5],
  roleRequirements: [
    { roleId: leadRole.id, min: 1, max: 2, isDefault: true },
    { roleId: nightRole.id, min: 0, max: 1, isDefault: true },
  ],
});

interface Scenario extends DatasetOverrides {
  readonly absenceCapacityRules?: readonly AbsenceCapacityRule[];
  readonly asOf?: string;
}

function issuesFor(scenario: Scenario): Issue[] {
  const data = makeDataset({ dayConfigurations: [weekday], ...scenario });
  const index = buildIndex(data);
  const coverageCells = computeCoverage({
    regionId: testRegion.id,
    range: RANGE,
    assignments: data.assignments,
    index,
  });
  return validate({
    regionId: testRegion.id,
    range: RANGE,
    assignments: data.assignments,
    absences: data.absences,
    compDays: data.compDays,
    coverageCells,
    absenceCapacityRules: scenario.absenceCapacityRules ?? [],
    index,
    asOf: scenario.asOf ?? '2026-09-07',
  });
}

function codes(issues: readonly Issue[]): IssueCode[] {
  return issues.map((issue) => issue.code);
}

function firstOf(issues: readonly Issue[], code: IssueCode): Issue | undefined {
  return issues.find((issue) => issue.code === code);
}

/** Пять будних дней подряд, чтобы минимум был закрыт и не мешал. */
const FILLED_WEEK = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];

describe('BLOCKING — дыры', () => {
  it('незакрытый минимум покрытия', () => {
    const issues = issuesFor({});
    const issue = firstOf(issues, 'COVERAGE_GAP');
    expect(issue?.level).toBe('BLOCKING');
    expect(issue?.category).toBe('GAP');
    expect(canPublish(issues, new Set())).toBe(false);
  });
});

/**
 * Конфликты не блокируют публикацию (ADR-0024) — они требуют подтверждения с
 * комментарием. Блокирующими остались только записи, которые не могут быть
 * верны ни при каком решении планировщика.
 */
describe('конфликты — подтверждаемые, не блокирующие', () => {
  it('назначение во время отпуска', () => {
    const absence: Absence = {
      id: 'abs-1',
      personId: 'p-1',
      type: 'VACATION',
      from: '2026-09-07',
      to: '2026-09-11',
      source: 'MANUAL',
    };
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-09')],
      absences: [absence],
    });
    const issue = firstOf(issues, 'ASSIGNED_DURING_ABSENCE');
    expect(issue?.level).toBe('WARNING');
    expect(issue?.category).toBe('CONFLICT');
    expect(issue?.date).toBe('2026-09-09');

    // Не блокирует, но и не проходит молча: нужен комментарий.
    expect(canPublish(issues, new Set())).toBe(false);
    expect(canPublish([issue!], new Set([issue!.key]))).toBe(true);
  });

  it('назначение на подтверждённый отгул', () => {
    const compDay: CompDayEntry = {
      id: 'cd-1',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-09-05',
      trigger: 'SATURDAY',
      actualDate: '2026-09-09',
      status: 'SCHEDULED',
    };
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-09')],
      compDays: [compDay],
    });
    expect(codes(issues)).toContain('ASSIGNED_DURING_COMP_DAY');
  });

  it('предложенный отгул назначение ещё не блокирует', () => {
    const compDay: CompDayEntry = {
      id: 'cd-2',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-09-05',
      trigger: 'SATURDAY',
      proposedDate: '2026-09-09',
      status: 'PROPOSED',
    };
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-09')],
      compDays: [compDay],
    });
    expect(codes(issues)).not.toContain('ASSIGNED_DURING_COMP_DAY');
  });

  it('роль вне eligibility человека', () => {
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', nightRole.id, '2026-09-09')],
    });
    const issue = firstOf(issues, 'ROLE_NOT_ELIGIBLE');
    expect(issue?.level).toBe('WARNING');
    expect(issue?.category).toBe('CONFLICT');
  });

  it('два назначения в один день остаются блокирующими', () => {
    // Это не решение планировщика, а невозможная запись: ровно одно
    // назначение на (человек, дата) — жёсткое ограничение модели.
    const person = makePerson({
      id: 'p-1',
      eligibility: [
        { roleId: leadRole.id, targetShare: 0.5 },
        { roleId: nightRole.id, targetShare: 0.5 },
      ],
    });
    const issues = issuesFor({
      people: [person],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        { ...makeAssignment('p-1', nightRole.id, '2026-09-09'), id: 'as-dup' },
      ],
    });
    expect(firstOf(issues, 'DOUBLE_ASSIGNMENT')?.level).toBe('BLOCKING');
  });

  it('два назначения в один день', () => {
    const person = makePerson({
      id: 'p-1',
      eligibility: [
        { roleId: leadRole.id, targetShare: 0.5 },
        { roleId: nightRole.id, targetShare: 0.5 },
      ],
    });
    const issues = issuesFor({
      people: [person],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', nightRole.id, '2026-09-09'),
      ],
    });
    const issue = firstOf(issues, 'DOUBLE_ASSIGNMENT');
    expect(issue?.level).toBe('BLOCKING');
    expect(issue?.category).toBe('CONFLICT');
  });
});

describe('WARNING', () => {
  it('перебор максимума', () => {
    const people = [
      makePerson({ id: 'p-1' }),
      makePerson({ id: 'p-2' }),
      makePerson({ id: 'p-3' }),
    ];
    const issues = issuesFor({
      people,
      assignments: people.map((p) => makeAssignment(p.id, leadRole.id, '2026-09-09')),
    });
    expect(firstOf(issues, 'COVERAGE_OVER_MAX')?.level).toBe('WARNING');
  });

  it('нехватка отдыха между ночной и дневной сменой', () => {
    const person = makePerson({
      id: 'p-1',
      eligibility: [
        { roleId: leadRole.id, targetShare: 0.5 },
        { roleId: nightRole.id, targetShare: 0.5 },
      ],
    });
    const issues = issuesFor({
      people: [person],
      assignments: [
        makeAssignment('p-1', nightRole.id, '2026-09-08'),
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
      ],
    });
    const issue = firstOf(issues, 'MIN_REST_VIOLATED');
    expect(issue?.level).toBe('WARNING');
    expect(issue?.date).toBe('2026-09-09');
  });

  it('перебор дней подряд', () => {
    const person = makePerson({
      id: 'p-1',
      constraints: { minRestHours: 8, maxConsecutiveDays: 3 },
    });
    const issues = issuesFor({
      people: [person],
      assignments: FILLED_WEEK.slice(0, 4).map((date) =>
        makeAssignment('p-1', leadRole.id, date),
      ),
    });
    const issue = firstOf(issues, 'CONSECUTIVE_DAYS_EXCEEDED');
    expect(issue?.level).toBe('WARNING');
    expect(issue?.message).toContain('4 consecutive days');
  });

  it('день недели вне доступности', () => {
    const person = makePerson({ id: 'p-1', availableWeekdays: [1, 2, 3, 4, 5] });
    const issues = issuesFor({
      people: [person],
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-12')],
    });
    expect(codes(issues)).toContain('UNAVAILABLE_WEEKDAY');
  });

  it('роль вне конфигурации этого дня', () => {
    // Выходных в конфигурации нет вовсе — суббота роли не предполагает.
    const person = makePerson({ id: 'p-1' });
    const issues = issuesFor({
      people: [person],
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-12')],
    });
    expect(codes(issues)).toContain('ROLE_NOT_IN_DAY_CONFIG');
  });

  it('отгул без свободного дня требует решения', () => {
    const pending: CompDayEntry = {
      id: 'cd-p',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-09-05',
      trigger: 'SATURDAY',
      status: 'PENDING_APPROVAL',
    };
    const issue = firstOf(issuesFor({ compDays: [pending] }), 'COMP_DAY_PENDING_APPROVAL');
    expect(issue?.level).toBe('WARNING');
  });

  it('лимит по пулу роли ловит то, чего не видит счётчик по региону', () => {
    // Четверо в регионе, двое умеют Lead. Оба в длинном отпуске: по региону
    // лимит 3 не превышен, по пулу Lead — превышен. ADR-0010.
    const people = [
      makePerson({ id: 'p-lead-1' }),
      makePerson({ id: 'p-lead-2' }),
      makePerson({ id: 'p-other-1', eligibility: [{ roleId: nightRole.id, targetShare: 1 }] }),
      makePerson({ id: 'p-other-2', eligibility: [{ roleId: nightRole.id, targetShare: 1 }] }),
    ];
    const longLeave = (personId: string, id: string): Absence => ({
      id,
      personId,
      type: 'VACATION',
      from: '2026-09-07',
      to: '2026-09-18',
      source: 'MANUAL',
    });

    const rules: AbsenceCapacityRule[] = [
      {
        id: 'acr-region',
        regionId: testRegion.id,
        scope: { kind: 'REGION' },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 3,
        countsTypes: ['VACATION', 'SICK', 'OTHER'],
        countsCompDays: true,
      },
      {
        id: 'acr-pool',
        regionId: testRegion.id,
        scope: { kind: 'ROLE_POOL', roleId: leadRole.id },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION', 'SICK', 'OTHER'],
        countsCompDays: true,
      },
    ];

    const issues = issuesFor({
      people,
      absences: [longLeave('p-lead-1', 'abs-1'), longLeave('p-lead-2', 'abs-2')],
      absenceCapacityRules: rules,
    });

    const capacity = issues.filter((issue) => issue.code === 'ABSENCE_CAPACITY_EXCEEDED');
    expect(capacity.length).toBeGreaterThan(0);
    expect(capacity.every((issue) => issue.roleId === leadRole.id)).toBe(true);
  });

  it('короткое отсутствие не попадает в лимит длительных', () => {
    const rules: AbsenceCapacityRule[] = [
      {
        id: 'acr-pool',
        regionId: testRegion.id,
        scope: { kind: 'ROLE_POOL', roleId: leadRole.id },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION'],
        countsCompDays: false,
      },
    ];
    const shortLeave = (personId: string, id: string): Absence => ({
      id,
      personId,
      type: 'VACATION',
      from: '2026-09-08',
      to: '2026-09-09',
      source: 'MANUAL',
    });
    const issues = issuesFor({
      people: [makePerson({ id: 'p-1' }), makePerson({ id: 'p-2' })],
      absences: [shortLeave('p-1', 'abs-1'), shortLeave('p-2', 'abs-2')],
      absenceCapacityRules: rules,
    });
    expect(codes(issues)).not.toContain('ABSENCE_CAPACITY_EXCEEDED');
  });
});

describe('INFO', () => {
  it('покрытие впритык — сигнал, а не блокер', () => {
    // Работа ровно по минимуму — норма этого ростера, а не отклонение.
    // Если бы это был WARNING, публикация требовала бы сотню обоснований.
    const issues = issuesFor({
      assignments: FILLED_WEEK.map((date) => makeAssignment('p-1', leadRole.id, date)),
    });
    const issue = firstOf(issues, 'COVERAGE_THIN');
    expect(issue?.level).toBe('INFO');
    expect(codes(issues)).not.toContain('COVERAGE_GAP');
    // И публикацию это не блокирует.
    expect(canPublish(issues, new Set())).toBe(true);
  });

  it('отклонение от целевой доли роли', () => {
    const person = makePerson({
      id: 'p-1',
      eligibility: [
        { roleId: leadRole.id, targetShare: 0.3 },
        { roleId: nightRole.id, targetShare: 0.7 },
      ],
    });
    const issues = issuesFor({
      people: [person],
      assignments: FILLED_WEEK.map((date) => makeAssignment('p-1', leadRole.id, date)),
    });
    const deviations = issues.filter((i) => i.code === 'TARGET_SHARE_DEVIATION');
    expect(deviations.every((i) => i.level === 'INFO' && i.category === 'FAIRNESS')).toBe(true);
    expect(deviations.find((i) => i.roleId === leadRole.id)?.message).toContain(
      'actual 100% vs target 30%',
    );
  });

  it('слишком мало смен — долей не считает', () => {
    const person = makePerson({
      id: 'p-1',
      eligibility: [
        { roleId: leadRole.id, targetShare: 0.3 },
        { roleId: nightRole.id, targetShare: 0.7 },
      ],
    });
    const issues = issuesFor({
      people: [person],
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-07')],
    });
    expect(codes(issues)).not.toContain('TARGET_SHARE_DEVIATION');
  });

  it('отгул, висящий дольше порога', () => {
    const old: CompDayEntry = {
      id: 'cd-1',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-06-06',
      trigger: 'SATURDAY',
      proposedDate: '2026-06-09',
      status: 'PROPOSED',
    };
    const issue = firstOf(issuesFor({ compDays: [old], asOf: '2026-09-07' }), 'COMP_DAY_AGING');
    expect(issue?.level).toBe('INFO');
    expect(issue?.message).toContain('outstanding');
  });

  it('свежий отгул не подсвечивается', () => {
    const fresh: CompDayEntry = {
      id: 'cd-2',
      personId: 'p-1',
      earnedForAssignmentId: 'as-y',
      earnedForDate: '2026-09-05',
      trigger: 'SATURDAY',
      proposedDate: '2026-09-09',
      status: 'PROPOSED',
    };
    expect(codes(issuesFor({ compDays: [fresh], asOf: '2026-09-07' }))).not.toContain(
      'COMP_DAY_AGING',
    );
  });

  it('отгулянное не стареет', () => {
    const taken: CompDayEntry = {
      id: 'cd-3',
      personId: 'p-1',
      earnedForAssignmentId: 'as-z',
      earnedForDate: '2026-06-06',
      trigger: 'SATURDAY',
      actualDate: '2026-06-09',
      status: 'TAKEN',
    };
    expect(codes(issuesFor({ compDays: [taken], asOf: '2026-09-07' }))).not.toContain(
      'COMP_DAY_AGING',
    );
  });
});

describe('сводка, публикация и подтверждения', () => {
  it('сортирует нарушения по уровню', () => {
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', nightRole.id, '2026-09-09')],
    });
    expect(issues[0]?.level).toBe('BLOCKING');
  });

  it('ключ нарушения стабилен между пересчётами', () => {
    const scenario: Scenario = {};
    expect(issuesFor(scenario).map((i) => i.key)).toEqual(issuesFor(scenario).map((i) => i.key));
  });

  it('сводка разделяет дыры и конфликты', () => {
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', nightRole.id, '2026-09-09')],
    });
    const summary = summarizeIssues(issues, new Set());
    expect(summary.gaps).toBeGreaterThan(0);
    expect(summary.conflicts).toBeGreaterThan(0);
    // Конфликт считается по категории независимо от уровня (ADR-0024), и в
    // blocking он больше не входит — там остались только дыры.
    expect(summary.blocking).toBe(summary.gaps);
  });

  it('публикация требует подтверждения всех предупреждений', () => {
    // Перебор максимума — настоящее предупреждение: три человека на роли
    // с max 2, при этом минимум закрыт и блокеров нет.
    const people = [
      makePerson({ id: 'p-1' }),
      makePerson({ id: 'p-2' }),
      makePerson({ id: 'p-3' }),
    ];
    const issues = issuesFor({
      people,
      assignments: [
        ...people.map((p) => makeAssignment(p.id, leadRole.id, '2026-09-09')),
        ...FILLED_WEEK.filter((d) => d !== '2026-09-09').map((date) =>
          makeAssignment('p-1', leadRole.id, date),
        ),
      ],
    });
    expect(issues.some((i) => i.level === 'BLOCKING')).toBe(false);
    expect(issues.some((i) => i.level === 'WARNING')).toBe(true);
    expect(canPublish(issues, new Set())).toBe(false);

    const acks = acknowledgedKeys(
      issues
        .filter((i) => i.level === 'WARNING')
        .map((i) => ({
          issueKey: i.key,
          comment: 'covered by the on-call engineer',
          byPersonId: 'p-planner',
          at: '2026-09-07T10:00:00Z',
        })),
    );
    expect(canPublish(issues, acks)).toBe(true);
    expect(summarizeIssues(issues, acks).unacknowledgedWarnings).toBe(0);
  });
});
