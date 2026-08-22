import { describe, expect, it } from 'vitest';
import { buildIndex } from '../domain/lookup.ts';
import type {
  Absence,
  AbsenceCapacityRule,
  CompDayEntry,
  CoverageRule,
  Issue,
  IssueCode,
} from '../domain/types.ts';
import {
  leadRole,
  makeAssignment,
  makeDataset,
  makePerson,
  nightRole,
  testUnit,
  type DatasetOverrides,
} from '../domain/testkit.ts';
import { computeCoverage } from './coverage.ts';
import { acknowledgedKeys, canPublish, summarizeIssues, validate } from './validate.ts';

const RANGE = { from: '2026-09-07', to: '2026-09-13' } as const;

const leadWeekdayRule: CoverageRule = {
  id: 'cr-weekday',
  unitId: testUnit.id,
  roleId: leadRole.id,
  appliesTo: 'WEEKDAY',
  min: 1,
  target: 2,
};

interface Scenario extends DatasetOverrides {
  readonly absenceCapacityRules?: readonly AbsenceCapacityRule[];
  readonly asOf?: string;
}

function issuesFor(scenario: Scenario): Issue[] {
  const data = makeDataset(scenario);
  const index = buildIndex(data);
  const coverageCells = computeCoverage({
    unitId: testUnit.id,
    range: RANGE,
    assignments: data.assignments,
    coverageRules: data.coverageRules,
    index,
  });
  return validate({
    unitId: testUnit.id,
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

describe('BLOCKING', () => {
  it('незакрытый минимум покрытия', () => {
    const issues = issuesFor({ coverageRules: [leadWeekdayRule] });
    const issue = firstOf(issues, 'COVERAGE_BELOW_MIN');
    expect(issue?.level).toBe('BLOCKING');
    expect(canPublish(issues)).toBe(false);
  });

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
    expect(issue?.level).toBe('BLOCKING');
    expect(issue?.date).toBe('2026-09-09');
    expect(issue?.personId).toBe('p-1');
  });

  it('назначение на подтверждённый отгул', () => {
    const compDay: CompDayEntry = {
      id: 'cd-1',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-09-05',
      trigger: 'SATURDAY',
      proposedDate: '2026-09-03',
      actualDate: '2026-09-09',
      status: 'SCHEDULED',
      expiresOn: '2026-11-28',
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
      expiresOn: '2026-11-28',
    };
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-09')],
      compDays: [compDay],
    });
    expect(codes(issues)).not.toContain('ASSIGNED_DURING_COMP_DAY');
  });

  it('две смены в один день', () => {
    const issues = issuesFor({
      people: [makePerson({ id: 'p-1', eligibility: [
        { roleId: leadRole.id, targetShare: 0.5 },
        { roleId: nightRole.id, targetShare: 0.5 },
      ] })],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', nightRole.id, '2026-09-09'),
      ],
    });
    expect(codes(issues)).toContain('DOUBLE_ASSIGNMENT');
  });

  it('роль вне eligibility человека', () => {
    const issues = issuesFor({
      assignments: [makeAssignment('p-1', nightRole.id, '2026-09-09')],
    });
    const issue = firstOf(issues, 'ROLE_NOT_ELIGIBLE');
    expect(issue?.level).toBe('BLOCKING');
    expect(issue?.roleId).toBe(nightRole.id);
  });
});

describe('WARNING', () => {
  it('недобор до цели покрытия', () => {
    const issues = issuesFor({
      coverageRules: [leadWeekdayRule],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-07'),
        makeAssignment('p-1', leadRole.id, '2026-09-08'),
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', leadRole.id, '2026-09-10'),
        makeAssignment('p-1', leadRole.id, '2026-09-11'),
      ],
    });
    const issue = firstOf(issues, 'COVERAGE_BELOW_TARGET');
    expect(issue?.level).toBe('WARNING');
    expect(codes(issues)).not.toContain('COVERAGE_BELOW_MIN');
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
    const person = makePerson({ id: 'p-1', constraints: { minRestHours: 8, maxConsecutiveDays: 3 } });
    const issues = issuesFor({
      people: [person],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-07'),
        makeAssignment('p-1', leadRole.id, '2026-09-08'),
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', leadRole.id, '2026-09-10'),
      ],
    });
    const issue = firstOf(issues, 'CONSECUTIVE_DAYS_EXCEEDED');
    expect(issue?.level).toBe('WARNING');
    expect(issue?.message).toContain('4 дней подряд');
  });

  it('день недели вне доступности человека', () => {
    const person = makePerson({ id: 'p-1', availableWeekdays: [1, 2, 3, 4, 5] });
    const issues = issuesFor({
      people: [person],
      assignments: [makeAssignment('p-1', leadRole.id, '2026-09-12')],
    });
    expect(codes(issues)).toContain('UNAVAILABLE_WEEKDAY');
  });

  it('лимит по пулу роли ловит то, чего не видит счётчик по единице', () => {
    // Четыре человека в единице, двое из них умеют SL. Оба уходят в длинный
    // отпуск: по единице лимит 3 не превышен, по пулу SL — превышен. ADR-0010.
    const leads = [
      makePerson({ id: 'p-lead-1' }),
      makePerson({ id: 'p-lead-2' }),
      makePerson({ id: 'p-other-1', eligibility: [{ roleId: nightRole.id, targetShare: 1 }] }),
      makePerson({ id: 'p-other-2', eligibility: [{ roleId: nightRole.id, targetShare: 1 }] }),
    ];
    const longVacation = (personId: string, id: string): Absence => ({
      id,
      personId,
      type: 'VACATION',
      from: '2026-09-07',
      to: '2026-09-18',
      source: 'MANUAL',
    });

    const rules: AbsenceCapacityRule[] = [
      {
        id: 'acr-unit',
        unitId: testUnit.id,
        scope: { kind: 'UNIT' },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 3,
        countsTypes: ['VACATION', 'COMP_DAY', 'TRAINING'],
      },
      {
        id: 'acr-pool',
        unitId: testUnit.id,
        scope: { kind: 'ROLE_POOL', roleId: leadRole.id },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION', 'COMP_DAY', 'TRAINING'],
      },
    ];

    const issues = issuesFor({
      people: leads,
      absences: [longVacation('p-lead-1', 'abs-1'), longVacation('p-lead-2', 'abs-2')],
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
        unitId: testUnit.id,
        scope: { kind: 'ROLE_POOL', roleId: leadRole.id },
        durationBucket: 'LONG',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsTypes: ['VACATION'],
      },
    ];
    const shortVacation = (personId: string, id: string): Absence => ({
      id,
      personId,
      type: 'VACATION',
      from: '2026-09-08',
      to: '2026-09-09',
      source: 'MANUAL',
    });
    const issues = issuesFor({
      people: [makePerson({ id: 'p-1' }), makePerson({ id: 'p-2' })],
      absences: [shortVacation('p-1', 'abs-1'), shortVacation('p-2', 'abs-2')],
      absenceCapacityRules: rules,
    });
    expect(codes(issues)).not.toContain('ABSENCE_CAPACITY_EXCEEDED');
  });
});

describe('INFO', () => {
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
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-07'),
        makeAssignment('p-1', leadRole.id, '2026-09-08'),
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', leadRole.id, '2026-09-10'),
        makeAssignment('p-1', leadRole.id, '2026-09-11'),
      ],
    });
    const deviations = issues.filter((i) => i.code === 'TARGET_SHARE_DEVIATION');
    expect(deviations.every((i) => i.level === 'INFO')).toBe(true);
    // Перекос виден с обеих сторон: SL сверх цели, NIGHT — недобор.
    expect(deviations.find((i) => i.roleId === leadRole.id)?.message).toContain(
      'факт 100% при цели 30%',
    );
    expect(deviations.find((i) => i.roleId === nightRole.id)?.message).toContain(
      'факт 0% при цели 70%',
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

  it('истекающий отгул', () => {
    const compDay: CompDayEntry = {
      id: 'cd-1',
      personId: 'p-1',
      earnedForAssignmentId: 'as-x',
      earnedForDate: '2026-06-06',
      trigger: 'SATURDAY',
      proposedDate: '2026-06-04',
      status: 'PROPOSED',
      expiresOn: '2026-09-20',
    };
    const issues = issuesFor({ compDays: [compDay], asOf: '2026-09-07' });
    expect(firstOf(issues, 'COMP_DAY_EXPIRING')?.level).toBe('INFO');
  });
});

describe('сводка и подтверждения', () => {
  it('сортирует нарушения по уровню', () => {
    const issues = issuesFor({
      coverageRules: [leadWeekdayRule],
      assignments: [makeAssignment('p-1', nightRole.id, '2026-09-09')],
    });
    expect(issues[0]?.level).toBe('BLOCKING');
  });

  it('ключ нарушения стабилен между пересчётами', () => {
    const scenario: Scenario = { coverageRules: [leadWeekdayRule] };
    expect(issuesFor(scenario).map((i) => i.key)).toEqual(issuesFor(scenario).map((i) => i.key));
  });

  it('подтверждение снимает предупреждение со счётчика', () => {
    const issues = issuesFor({
      coverageRules: [leadWeekdayRule],
      assignments: [
        makeAssignment('p-1', leadRole.id, '2026-09-07'),
        makeAssignment('p-1', leadRole.id, '2026-09-08'),
        makeAssignment('p-1', leadRole.id, '2026-09-09'),
        makeAssignment('p-1', leadRole.id, '2026-09-10'),
        makeAssignment('p-1', leadRole.id, '2026-09-11'),
      ],
    });
    const warning = issues.find((issue) => issue.level === 'WARNING');
    expect(warning).toBeDefined();

    const before = summarizeIssues(issues, new Set());
    const after = summarizeIssues(
      issues,
      acknowledgedKeys([
        {
          issueKey: warning?.key ?? '',
          comment: 'закрываем силами дежурного',
          byPersonId: 'p-planner',
          at: '2026-09-07T10:00:00Z',
        },
      ]),
    );

    expect(after.warning).toBe(before.warning);
    expect(after.unacknowledgedWarnings).toBe(before.unacknowledgedWarnings - 1);
  });
});
