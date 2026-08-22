/**
 * Сводки по уже посчитанным нарушениям — факт про экран, а не про план.
 *
 * Сами нарушения теперь считает сервер (`GET /api/schedule`, Phase 5); эти
 * три функции остаются в TS, потому что они не решают, что является
 * нарушением, а только агрегируют готовый список для панели и кнопки
 * Publish. Раньше жили в `engine/validate.ts` вместе с самим движком
 * валидации — тот файл удалён вместе с портом на бэкенд.
 */

import type { Acknowledgement, Issue } from '../domain/types.ts';

export function acknowledgedKeys(acks: readonly Acknowledgement[]): Set<string> {
  return new Set(acks.map((ack) => ack.issueKey));
}

/**
 * Настоящая непокрытая дыра — не `CoverageThin` (тот держится ровно на
 * минимуме, а не ниже него; CLAUDE.md §11, ADR-0034).
 *
 * По коду, не по уровню: `COVERAGE_GAP` — теперь `INFO`, не `BLOCKING`
 * (ADR-0035, owner review — дыры не должны мешать сохранять черновик), но
 * по смыслу остаётся дырой и должна считаться и подсвечиваться как раньше.
 */
export function isCoverageGap(issue: Issue): boolean {
  return issue.code === 'COVERAGE_GAP';
}

/**
 * Можно ли публиковать: нет BLOCKING (ADR-0037, owner review — то же
 * рассуждение, что и для дыр в ADR-0035: неподтверждённый warning — сигнал,
 * а не невозможные данные, и требовать подтверждения перед сохранением
 * значит стопорить планировщика по мелочам). Подтверждение с комментарием
 * остаётся доступным и осмысленным — это запись «почему мы вышли за рамки»,
 * — но больше не условие публикации. Единственное, что всё ещё блокирует:
 * двойное назначение и смена, которой не существует или которая принадлежит
 * другой единице.
 */
export function canPublish(issues: readonly Issue[]): boolean {
  return !issues.some((issue) => issue.level === 'BLOCKING');
}

export interface IssueSummary {
  readonly blocking: number;
  readonly gaps: number;
  readonly conflicts: number;
  readonly warning: number;
  readonly info: number;
  readonly unacknowledgedWarnings: number;
}

export function summarizeIssues(
  issues: readonly Issue[],
  acknowledged: ReadonlySet<string>,
): IssueSummary {
  let blocking = 0;
  let gaps = 0;
  let conflicts = 0;
  let warning = 0;
  let info = 0;
  let unacknowledgedWarnings = 0;

  for (const issue of issues) {
    // Категория считается независимо от уровня: конфликт остаётся конфликтом,
    // даже когда он подтверждаемый, а не блокирующий (ADR-0024). Дыра — тоже:
    // по коду, не по уровню — `isCoverageGap` не зависит от того, что
    // CoverageGap стал INFO (ADR-0035).
    if (issue.category === 'CONFLICT') conflicts += 1;
    if (isCoverageGap(issue)) gaps += 1;

    if (issue.level === 'BLOCKING') {
      blocking += 1;
    } else if (issue.level === 'INFO') {
      info += 1;
    } else {
      warning += 1;
      if (!acknowledged.has(issue.key)) unacknowledgedWarnings += 1;
    }
  }
  return { blocking, gaps, conflicts, warning, info, unacknowledgedWarnings };
}
