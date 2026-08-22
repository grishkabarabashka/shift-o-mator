/**
 * NOTE: Summaries over already-computed issues — a fact about the screen,
 * not about the plan.
 *
 * Issues themselves are now computed server-side (`GET /api/schedule`,
 * Phase 5); these three functions stay in TS because they don't decide what
 * counts as an issue, only aggregate the finished list for the panel and the
 * Publish button. They used to live in `engine/validate.ts` alongside the
 * validation engine itself — that file was deleted along with the port to
 * the backend.
 */

import type { Acknowledgement, Issue } from '../domain/types.ts';

export function acknowledgedKeys(acks: readonly Acknowledgement[]): Set<string> {
  return new Set(acks.map((ack) => ack.issueKey));
}

/**
 * NOTE: A genuine uncovered gap — not `CoverageThin` (that one holds exactly
 * at the minimum, not below it; CLAUDE.md §11, ADR-0034).
 *
 * By code, not by level: `COVERAGE_GAP` is now `INFO`, not `BLOCKING`
 * (ADR-0035, owner review — gaps must not block saving a draft), but it
 * remains a gap in meaning and must still be counted and highlighted as
 * before.
 */
export function isCoverageGap(issue: Issue): boolean {
  return issue.code === 'COVERAGE_GAP';
}

/**
 * NOTE: Whether publishing is allowed: no BLOCKING issues (ADR-0037, owner
 * review — the same reasoning as for gaps in ADR-0035: an unacknowledged
 * warning is a signal, not corrupt data, and requiring acknowledgement
 * before saving would stall the planner over minor things). Acknowledging
 * with a comment stays available and meaningful — it's a record of "why we
 * went outside the rule" — but is no longer a precondition for publishing.
 * The only things that still block: a double assignment, and a shift that
 * doesn't exist or belongs to a different unit.
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
    // NOTE: Category is tallied independently of level: a conflict stays a
    // conflict even when it's acknowledgeable rather than blocking
    // (ADR-0024). Same for a gap: by code, not by level — `isCoverageGap`
    // doesn't depend on CoverageGap having become INFO (ADR-0035).
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
