/**
 * NOTE: Collapses the flat issue list into findings.
 * NOTE: The flat list is what the validator counted, not what a planner can
 * read: a month for one unit adds up to two hundred-plus rows, and "Cover
 * understaffed" twelve times looks like twelve different problems. It's one
 * finding: Cover understaffed, twelve days. Dates are a detail you drill into
 * once you've decided to act on it.
 * NOTE: The grouping rule matches `IssueDigest` on the backend (Docs/06): key
 * is (code, subject), where subject is a shift, a person, or the unit itself.
 * Matching deliberately — the panel and the text summary must describe the
 * same thing, or there's nothing for the summary to be checked against.
 */

import type { DatasetIndex } from '../../domain/lookup.ts';
import type { Issue, IssueCode, IsoDate } from '../../domain/types.ts';

export interface IssueGroup {
  readonly key: string;
  /** NOTE: "Cover", "Anna Petrova" — in the reader's words, not an identifier. */
  readonly subject: string;
  /** NOTE: "understaffed", "rostered while absent" — exactly what's wrong with it. */
  readonly what: string;
  readonly issues: readonly Issue[];
  readonly dates: readonly IsoDate[];
  /** NOTE: Count of still-unacknowledged warnings — this is what makes the group "hot". */
  readonly unacknowledged: number;
}

/**
 * NOTE: Short wording per code. The issue's own message doesn't fit here: it
 * carries the date and numbers for that specific day, while the group header
 * must be the same across all its days.
 */
const WHAT: Record<IssueCode, string> = {
  COVERAGE_GAP: 'uncovered',
  COVERAGE_THIN: 'thin cover',
  COVERAGE_OVER_MAX: 'over the ceiling',
  ASSIGNED_DURING_ABSENCE: 'rostered while absent',
  ASSIGNED_DURING_COMP_DAY: 'rostered on a comp day',
  DOUBLE_ASSIGNMENT: 'two assignments in one day',
  SHIFT_NOT_ELIGIBLE: 'not eligible for this shift',
  SHIFT_OUTSIDE_REGION: 'shift from another unit',
  SHIFT_NOT_IN_DAY_CONFIG: 'shift not offered this day',
  ABSENCE_CAPACITY_EXCEEDED: 'too many away at once',
  MIN_REST_VIOLATED: 'rest below the minimum',
  CONSECUTIVE_DAYS_EXCEEDED: 'too many days in a row',
  WEEKEND_LOAD_EXCEEDED: 'weekend load above target',
  UNAVAILABLE_WEEKDAY: 'rostered on an unavailable weekday',
  PREFERENCE_VIOLATED: 'against a stated preference',
  TARGET_SHARE_DEVIATION: 'off their target share',
  COMP_DAY_AGING: 'comp day outstanding too long',
  COMP_DAY_PENDING_APPROVAL: 'comp day needs approval',
};

function subjectOf(issue: Issue, index: DatasetIndex | undefined): string {
  if (issue.shiftId) return index?.shifts.get(issue.shiftId)?.code ?? issue.shiftId;
  if (issue.personId) return index?.people.get(issue.personId)?.displayName ?? issue.personId;
  return issue.unitId;
}

export function groupIssues(
  issues: readonly Issue[],
  index: DatasetIndex | undefined,
  acknowledged: ReadonlySet<string>,
): IssueGroup[] {
  const byKey = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = `${issue.code}|${subjectOf(issue, index)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(issue);
    else byKey.set(key, [issue]);
  }

  return [...byKey.entries()]
    .map(([key, group]) => {
      const first = group[0] as Issue;
      return {
        key,
        subject: subjectOf(first, index),
        what: WHAT[first.code] ?? first.code.toLowerCase().replace(/_/g, ' '),
        issues: [...group].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
        dates: [
          ...new Set(group.map((i) => i.date).filter((d): d is IsoDate => d !== undefined)),
        ].sort(),
        unacknowledged: group.filter((i) => i.level === 'WARNING' && !acknowledged.has(i.key))
          .length,
      };
    })
    // NOTE: Most frequent first: one gap over twelve days matters more than
    // twelve different ones over one. Ties break alphabetically so the order
    // doesn't jitter.
    .sort((a, b) => b.issues.length - a.issues.length || a.subject.localeCompare(b.subject));
}

/** NOTE: "Sep 4 – Sep 25" or "Sep 4" — the caption under a group header. */
export function dateSpanLabel(dates: readonly IsoDate[]): string {
  if (dates.length === 0) return '';
  const short = (date: IsoDate) => date.slice(5).replace('-', '/');
  const first = dates[0] as IsoDate;
  if (dates.length === 1) return short(first);
  return `${short(first)} – ${short(dates[dates.length - 1] as IsoDate)}`;
}
