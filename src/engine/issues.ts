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

/** Можно ли публиковать: нет BLOCKING и все WARNING подтверждены. */
export function canPublish(
  issues: readonly Issue[],
  acknowledged: ReadonlySet<string>,
): boolean {
  return !issues.some(
    (issue) =>
      issue.level === 'BLOCKING' ||
      (issue.level === 'WARNING' && !acknowledged.has(issue.key)),
  );
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
    // даже когда он подтверждаемый, а не блокирующий (ADR-0024).
    if (issue.category === 'CONFLICT') conflicts += 1;

    if (issue.level === 'BLOCKING') {
      blocking += 1;
      if (issue.category === 'GAP') gaps += 1;
    } else if (issue.level === 'INFO') {
      info += 1;
    } else {
      warning += 1;
      if (!acknowledged.has(issue.key)) unacknowledgedWarnings += 1;
    }
  }
  return { blocking, gaps, conflicts, warning, info, unacknowledgedWarnings };
}
