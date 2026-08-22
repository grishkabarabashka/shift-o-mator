/**
 * Сворачивание списка нарушений в находки.
 *
 * Плоский список — это то, что валидатор насчитал, а не то, что планировщик
 * может прочесть: за месяц по единице набирается двести с лишним строк, и «Cover
 * недобран» двенадцать раз выглядит как двенадцать разных проблем. Находка одна:
 * Cover недобран, двенадцать дней. Даты — подробность, за которой лезут, когда
 * решили этим заняться.
 *
 * Правило группировки то же, что у `IssueDigest` на бэке (Docs/06): ключ —
 * (код, предмет), где предмет — смена, человек или сама единица. Одинаково
 * здесь и там намеренно: панель и текстовое саммари обязаны говорить об одном и
 * том же, иначе саммари не с чем сверять.
 */

import type { DatasetIndex } from '../../domain/lookup.ts';
import type { Issue, IssueCode, IsoDate } from '../../domain/types.ts';

export interface IssueGroup {
  readonly key: string;
  /** «Cover», «Anna Petrova» — в словах читателя, не идентификатором. */
  readonly subject: string;
  /** «understaffed», «rostered while absent» — что именно с ним не так. */
  readonly what: string;
  readonly issues: readonly Issue[];
  readonly dates: readonly IsoDate[];
  /** Есть ли ещё неподтверждённые предупреждения — по ним группа и «горит». */
  readonly unacknowledged: number;
}

/**
 * Короткая формулировка на код. Сообщение самого нарушения сюда не годится: оно
 * несёт дату и цифры этого конкретного дня, а заголовок группы должен быть
 * одинаков для всех её дней.
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
    // Самое частое первым: одна дыра на двенадцать дней важнее двенадцати разных
    // на один. Внутри равенства — по алфавиту, чтобы порядок не плясал.
    .sort((a, b) => b.issues.length - a.issues.length || a.subject.localeCompare(b.subject));
}

/** «Sep 4 – Sep 25» или «Sep 4» — подпись под заголовком группы. */
export function dateSpanLabel(dates: readonly IsoDate[]): string {
  if (dates.length === 0) return '';
  const short = (date: IsoDate) => date.slice(5).replace('-', '/');
  const first = dates[0] as IsoDate;
  if (dates.length === 1) return short(first);
  return `${short(first)} – ${short(dates[dates.length - 1] as IsoDate)}`;
}
