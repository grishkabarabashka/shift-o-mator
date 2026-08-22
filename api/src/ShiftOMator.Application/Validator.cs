using ShiftOMator.Domain;
using static ShiftOMator.Domain.DomainHelpers;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/validate.ts (ADR-0009). Three levels that never mix: BLOCKING —
/// publication is impossible; WARNING — needs a deliberate acknowledgement with a
/// comment; INFO — highlighted, never blocking. Two categories the UI never merges:
/// GAP — work not done, fixed by assigning someone; CONFLICT — an assignment
/// contradicts another record, fixed by removing it or acknowledging it.
///
/// A conflict no longer blocks (ADR-0024). A person coming in during their own leave,
/// or a role handed out off-eligibility during a crunch, are decisions made in reality;
/// the system must record, highlight and remember the reason, not refuse to save.
/// Only records that cannot be right under any decision stay BLOCKING: two assignments
/// on the same day, and a role that doesn't exist or belongs to another region.
/// </summary>
public static class Validator
{
    public record ValidateParams(
        string RegionId,
        DateOnly RangeFrom,
        DateOnly RangeTo,
        IReadOnlyList<Assignment> Assignments,
        IReadOnlyList<Absence> Absences,
        IReadOnlyList<CompDayEntry> CompDays,
        IReadOnlyList<CoverageCell> CoverageCells,
        IReadOnlyList<AbsenceCapacityRule> AbsenceCapacityRules,
        DatasetIndex Index,
        /// <summary>Reference date for comp-day age.</summary>
        DateOnly AsOf);

    private record IssueDraft(
        IssueLevel Level, IssueCategory Category, IssueCode Code, string Message,
        DateOnly? Date = null, string? PersonId = null, string? RoleId = null);

    // .NET's enum ToString() yields PascalCase (CoverageGap); the TS source's
    // IssueCode string literals are SCREAMING_SNAKE_CASE (COVERAGE_GAP) and that
    // format is baked into Issue.Key everywhere it's used (acknowledgement
    // matching, eventually the wire format) — so convert, don't pass through.
    private static string IssueCodeWireName(IssueCode code)
    {
        var pascal = code.ToString();
        var sb = new System.Text.StringBuilder();
        for (var i = 0; i < pascal.Length; i++)
        {
            if (i > 0 && char.IsUpper(pascal[i])) sb.Append('_');
            sb.Append(pascal[i]);
        }
        return sb.ToString().ToUpperInvariant();
    }

    private static Issue MakeIssue(string regionId, IssueDraft d)
    {
        // SCREAMING_SNAKE_CASE, matching the TypeScript client's IssueCode string
        // literals exactly — Issue.Key is compared byte-for-byte against the client's
        // in the engine differential test, and will be the wire format once the API
        // serves this (Phase 5).
        var key = string.Join('|', IssueCodeWireName(d.Code), d.Date?.ToString("yyyy-MM-dd") ?? "", d.PersonId ?? "", d.RoleId ?? "");
        return new Issue
        {
            Key = key, Level = d.Level, Category = d.Category, Code = d.Code, Message = d.Message,
            RegionId = regionId, Date = d.Date, PersonId = d.PersonId, RoleId = d.RoleId,
        };
    }

    private static readonly Dictionary<IssueLevel, int> LevelOrder = new()
    {
        [IssueLevel.Blocking] = 0, [IssueLevel.Warning] = 1, [IssueLevel.Info] = 2,
    };

    public static List<Issue> Validate(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        drafts.AddRange(CheckCoverage(p));
        drafts.AddRange(CheckAssignments(p));
        drafts.AddRange(CheckRest(p));
        drafts.AddRange(CheckConsecutiveDays(p));
        drafts.AddRange(CheckWeekendLoad(p));
        drafts.AddRange(CheckAbsenceCapacity(p));
        drafts.AddRange(CheckTargetShares(p));
        drafts.AddRange(CheckCompDays(p));

        return drafts
            .Select(d => MakeIssue(p.RegionId, d))
            .OrderBy(i => LevelOrder[i.Level])
            .ThenBy(i => i.Date?.ToString("yyyy-MM-dd") ?? "", StringComparer.Ordinal)
            .ThenBy(i => i.Key, StringComparer.Ordinal)
            .ToList();
    }

    public static HashSet<string> AcknowledgedKeys(IEnumerable<Acknowledgement> acks) =>
        acks.Select(a => a.IssueKey).ToHashSet();

    /// <summary>No BLOCKING and every WARNING acknowledged.</summary>
    public static bool CanPublish(IReadOnlyList<Issue> issues, IReadOnlySet<string> acknowledged) =>
        !issues.Any(i => i.Level == IssueLevel.Blocking || (i.Level == IssueLevel.Warning && !acknowledged.Contains(i.Key)));

    public record IssueSummary(int Blocking, int Gaps, int Conflicts, int Warning, int Info, int UnacknowledgedWarnings);

    public static IssueSummary Summarize(IReadOnlyList<Issue> issues, IReadOnlySet<string> acknowledged)
    {
        int blocking = 0, gaps = 0, conflicts = 0, warning = 0, info = 0, unacknowledged = 0;
        foreach (var issue in issues)
        {
            // Категория считается независимо от уровня: конфликт остаётся конфликтом,
            // даже когда он подтверждаемый, а не блокирующий (ADR-0024).
            if (issue.Category == IssueCategory.Conflict) conflicts++;

            if (issue.Level == IssueLevel.Blocking)
            {
                blocking++;
                if (issue.Category == IssueCategory.Gap) gaps++;
            }
            else if (issue.Level == IssueLevel.Info)
            {
                info++;
            }
            else
            {
                warning++;
                if (!acknowledged.Contains(issue.Key)) unacknowledged++;
            }
        }
        return new IssueSummary(blocking, gaps, conflicts, warning, info, unacknowledged);
    }

    // -------------------------------------------------------------------------
    // Покрытие
    // -------------------------------------------------------------------------

    private static List<IssueDraft> CheckCoverage(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        foreach (var cell in p.CoverageCells)
        {
            var code = p.Index.Roles.GetValueOrDefault(cell.RoleId)?.Code ?? cell.RoleId;
            var label = cell.RuleLabel is not null ? $" ({cell.RuleLabel})" : "";

            if (cell.Level == CoverageLevel.Gap)
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Gap, IssueCode.CoverageGap,
                    $"{code}{label}: {cell.Actual} assigned, minimum is {cell.Min}", cell.Date, RoleId: cell.RoleId));
            }
            else if (cell.Level == CoverageLevel.Thin)
            {
                // INFO, не WARNING: работа впритык — норма, а не отклонение.
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Gap, IssueCode.CoverageThin,
                    $"{code}{label}: {cell.Actual} assigned, exactly at the minimum — no slack", cell.Date, RoleId: cell.RoleId));
            }
            else if (cell.Level == CoverageLevel.Over && cell.Max is not null)
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.CoverageOverMax,
                    $"{code}{label}: {cell.Actual} assigned, maximum is {cell.Max}", cell.Date, RoleId: cell.RoleId));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // Назначения
    // -------------------------------------------------------------------------

    private static List<Assignment> RegionAssignments(ValidateParams p) =>
        p.Assignments.Where(a => p.Index.People.TryGetValue(a.PersonId, out var person) && person.RegionId == p.RegionId).ToList();

    private static List<IssueDraft> CheckAssignments(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();

        var absencesByPerson = p.Absences.GroupBy(a => a.PersonId).ToDictionary(g => g.Key, g => g.ToList());

        var blockingCompDays = new Dictionary<string, CompDayEntry>();
        foreach (var entry in p.CompDays)
        {
            if (!CompDayBlocksAssignment(entry)) continue;
            var date = EffectiveCompDayDate(entry);
            if (date is not null) blockingCompDays[DatasetIndex.CellKey(entry.PersonId, date.Value)] = entry;
        }

        var seenCell = new HashSet<string>();

        foreach (var assignment in RegionAssignments(p))
        {
            if (assignment.Date < p.RangeFrom || assignment.Date > p.RangeTo) continue;
            if (!p.Index.People.TryGetValue(assignment.PersonId, out var person)) continue;

            var key = DatasetIndex.CellKey(person.Id, assignment.Date);
            if (!seenCell.Add(key))
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.DoubleAssignment,
                    $"{person.DisplayName}: more than one assignment on the same day", assignment.Date, person.Id));
            }

            if (!IsWorkingAssignment(assignment)) continue;

            var roleId = AssignmentRoleId(assignment);
            var role = roleId is not null ? p.Index.Roles.GetValueOrDefault(roleId) : null;

            if (role is null)
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.RoleOutsideRegion,
                    $"Role {roleId ?? "?"} does not exist", assignment.Date, person.Id));
                continue;
            }

            if (role.RegionId != person.RegionId)
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.RoleOutsideRegion,
                    $"{person.DisplayName}: role {role.Code} belongs to another region", assignment.Date, person.Id, role.Id));
            }
            else if (!person.Eligibility.Any(e => e.RoleId == role.Id))
            {
                // Не блокер: аврал закрывают тем, кто есть, и осознанный отход от
                // eligibility допустим, если он подтверждён (ADR-0024).
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.RoleNotEligible,
                    $"{person.DisplayName}: role {role.Code} is outside their eligibility", assignment.Date, person.Id, role.Id));
            }
            else
            {
                var config = DayConfigurationResolver.Resolve(p.RegionId, assignment.Date, p.Index);
                var inConfig = config?.RoleRequirements.Any(r => r.RoleId == role.Id) ?? false;
                if (!inConfig)
                {
                    drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.RoleNotInDayConfig,
                        $"{person.DisplayName}: role {role.Code} is not part of this day's configuration", assignment.Date, person.Id, role.Id));
                }
            }

            var absence = absencesByPerson.GetValueOrDefault(person.Id)?.FirstOrDefault(a => assignment.Date >= a.From && assignment.Date <= a.To);
            if (absence is not null)
            {
                // Не блокер: человек выходит в свой отпуск, либо запись устарела —
                // оба случая разрешает планировщик, а не валидатор.
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.AssignedDuringAbsence,
                    $"{person.DisplayName}: assigned during {AbsenceLabel(absence.Type)}", assignment.Date, person.Id, role.Id));
            }

            if (blockingCompDays.ContainsKey(key))
            {
                // Не блокер: отгул переносится, запись остаётся видимой — comp day
                // не сгорает (ADR-0007).
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.AssignedDuringCompDay,
                    $"{person.DisplayName}: assigned on a confirmed comp day", assignment.Date, person.Id, role.Id));
            }

            if (!person.AvailableWeekdays.Contains(DateHelpers.IsoWeekdayOf(assignment.Date)))
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.UnavailableWeekday,
                    $"{person.DisplayName}: weekday outside availability", assignment.Date, person.Id, role.Id));
            }

            if (person.Preferences?.AvoidsWeekdays?.Contains(DateHelpers.IsoWeekdayOf(assignment.Date)) == true)
            {
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Policy, IssueCode.PreferenceViolated,
                    $"{person.DisplayName}: a day this person prefers to avoid", assignment.Date, person.Id, role.Id));
            }
        }

        return drafts;
    }

    private static string AbsenceLabel(AbsenceType type) => type switch
    {
        AbsenceType.Vacation => "vacation",
        AbsenceType.Sick => "sick leave",
        _ => "an absence",
    };

    // -------------------------------------------------------------------------
    // Отдых и дни подряд
    // -------------------------------------------------------------------------

    private record DatedInterval(DateOnly Date, UtcInterval Interval);

    private static Dictionary<string, List<DatedInterval>> IntervalsByPerson(ValidateParams p)
    {
        var result = new Dictionary<string, List<DatedInterval>>();
        foreach (var assignment in RegionAssignments(p))
        {
            var roleId = AssignmentRoleId(assignment);
            if (roleId is null) continue;
            if (!p.Index.Roles.TryGetValue(roleId, out var role)) continue;
            UtcInterval interval;
            try
            {
                interval = DateHelpers.ShiftInterval(role, assignment.Date, assignment.TimeOverride);
            }
            catch { continue; }
            if (!result.TryGetValue(assignment.PersonId, out var bucket)) result[assignment.PersonId] = bucket = [];
            bucket.Add(new DatedInterval(assignment.Date, interval));
        }
        foreach (var bucket in result.Values) bucket.Sort((a, b) => a.Interval.Start.CompareTo(b.Interval.Start));
        return result;
    }

    private static List<IssueDraft> CheckRest(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        foreach (var (personId, intervals) in IntervalsByPerson(p))
        {
            if (!p.Index.People.TryGetValue(personId, out var person)) continue;
            for (var i = 1; i < intervals.Count; i++)
            {
                var previous = intervals[i - 1];
                var current = intervals[i];
                if (current.Date < p.RangeFrom || current.Date > p.RangeTo) continue;
                var rest = DateHelpers.RestHoursBetween(previous.Interval, current.Interval);
                if (rest >= person.Constraints.MinRestHours) continue;
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.MinRestViolated,
                    $"{person.DisplayName}: {rest:F1}h rest, minimum is {person.Constraints.MinRestHours}h", current.Date, personId));
            }
        }
        return drafts;
    }

    private static List<IssueDraft> CheckConsecutiveDays(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var datesByPerson = new Dictionary<string, SortedSet<DateOnly>>();
        foreach (var assignment in RegionAssignments(p))
        {
            if (!IsWorkingAssignment(assignment)) continue;
            if (!datesByPerson.TryGetValue(assignment.PersonId, out var bucket)) datesByPerson[assignment.PersonId] = bucket = [];
            bucket.Add(assignment.Date);
        }

        foreach (var (personId, dates) in datesByPerson)
        {
            if (!p.Index.People.TryGetValue(personId, out var person)) continue;
            var limit = person.Constraints.MaxConsecutiveDays;
            var sorted = dates.ToList();

            DateOnly? runStart = null;
            var runLength = 0;
            DateOnly? previous = null;

            void Flush()
            {
                if (runLength > limit && runStart is not null && previous is not null && previous >= p.RangeFrom && previous <= p.RangeTo)
                {
                    drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.ConsecutiveDaysExceeded,
                        $"{person.DisplayName}: {runLength} consecutive days, limit is {limit} (since {runStart:yyyy-MM-dd})", previous, personId));
                }
            }

            foreach (var date in sorted)
            {
                if (previous is not null && previous.Value.AddDays(1) == date) runLength++;
                else { Flush(); runStart = date; runLength = 1; }
                previous = date;
            }
            Flush();
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // Нагрузка по выходным
    // -------------------------------------------------------------------------

    private const int QuarterWindowDays = 91;

    private static List<IssueDraft> CheckWeekendLoad(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var datesByPerson = new Dictionary<string, List<DateOnly>>();
        foreach (var assignment in RegionAssignments(p))
        {
            if (!IsWorkingAssignment(assignment)) continue;
            if (!datesByPerson.TryGetValue(assignment.PersonId, out var bucket)) datesByPerson[assignment.PersonId] = bucket = [];
            bucket.Add(assignment.Date);
        }

        foreach (var (personId, dates) in datesByPerson)
        {
            if (!p.Index.People.TryGetValue(personId, out var person)) continue;
            var limit = person.Constraints.MaxWeekendsPerQuarter;
            if (limit is null) continue;
            if (!p.Index.Locations.TryGetValue(person.LocationId, out var location)) continue;

            var weekendDates = dates.Where(d => DateHelpers.IsWeekendIn(d, location)).OrderBy(d => d).ToList();
            foreach (var date in weekendDates)
            {
                if (date < p.RangeFrom || date > p.RangeTo) continue;
                var windowStart = date.AddDays(-(QuarterWindowDays - 1));
                var inWindow = weekendDates.Count(d => d >= windowStart && d <= date);
                if (inWindow > limit)
                {
                    drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Fairness, IssueCode.WeekendLoadExceeded,
                        $"{person.DisplayName}: {inWindow} weekend days this quarter, target is {limit}", date, personId));
                }
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // Лимиты одновременных отсутствий
    // -------------------------------------------------------------------------

    private record AbsenceSpan(string PersonId, AbsenceType? Type, bool IsCompDay, DateOnly From, DateOnly To, int Workdays);

    private static List<AbsenceSpan> AbsenceSpans(ValidateParams p)
    {
        var spans = new List<AbsenceSpan>();

        Location? LocationOf(string personId)
        {
            if (!p.Index.People.TryGetValue(personId, out var person) || person.RegionId != p.RegionId) return null;
            return p.Index.Locations.GetValueOrDefault(person.LocationId);
        }

        foreach (var absence in p.Absences)
        {
            var location = LocationOf(absence.PersonId);
            if (location is null) continue;
            spans.Add(new AbsenceSpan(absence.PersonId, absence.Type, false, absence.From, absence.To,
                DateHelpers.CountWorkdays(absence.From, absence.To, location, p.Index)));
        }

        // Подтверждённый отгул занимает человека так же, как отпуск.
        foreach (var entry in p.CompDays)
        {
            if (!CompDayBlocksAssignment(entry)) continue;
            var location = LocationOf(entry.PersonId);
            if (location is null) continue;
            var date = EffectiveCompDayDate(entry);
            if (date is null) continue;
            spans.Add(new AbsenceSpan(entry.PersonId, null, true, date.Value, date.Value, 1));
        }

        return spans;
    }

    private static List<IssueDraft> CheckAbsenceCapacity(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var rules = p.AbsenceCapacityRules.Where(r => r.RegionId == p.RegionId).ToList();
        if (rules.Count == 0) return drafts;

        var spans = AbsenceSpans(p);

        foreach (var date in DateHelpers.EachDate(p.RangeFrom, p.RangeTo))
        {
            var active = spans.Where(s => date >= s.From && date <= s.To).ToList();
            if (active.Count == 0) continue;

            foreach (var rule in rules)
            {
                var matching = active.Where(span =>
                {
                    if (span.IsCompDay) { if (!rule.CountsCompDays) return false; }
                    else if (span.Type is null || !rule.CountsTypes.Contains(span.Type.Value)) return false;

                    var isLong = span.Workdays >= rule.LongThresholdWorkdays;
                    if (rule.DurationBucket == AbsenceDurationBucket.Long && !isLong) return false;
                    if (rule.DurationBucket == AbsenceDurationBucket.Short && isLong) return false;
                    if (rule.ScopeKind == AbsenceCapacityScopeKind.Region) return true;

                    var person = p.Index.People.GetValueOrDefault(span.PersonId);
                    return person?.Eligibility.Any(e => e.RoleId == rule.ScopeRoleId) ?? false;
                }).ToList();

                if (matching.Count <= rule.MaxConcurrent) continue;

                var scopeLabel = rule.ScopeKind == AbsenceCapacityScopeKind.Region
                    ? "region-wide"
                    : $"in the {p.Index.Roles.GetValueOrDefault(rule.ScopeRoleId ?? "")?.Code ?? rule.ScopeRoleId} pool";
                var bucketLabel = rule.DurationBucket == AbsenceDurationBucket.Long ? "long" : "short";

                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.AbsenceCapacityExceeded,
                    $"{matching.Count} {bucketLabel} absences {scopeLabel}, limit is {rule.MaxConcurrent}", date,
                    RoleId: rule.ScopeKind == AbsenceCapacityScopeKind.RolePool ? rule.ScopeRoleId : null));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // Целевые доли ролей
    // -------------------------------------------------------------------------

    private const int MinAssignmentsForShare = 5;
    private const double ShareTolerance = 0.25;

    private static List<IssueDraft> CheckTargetShares(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var byPerson = new Dictionary<string, Dictionary<string, int>>();
        var totals = new Dictionary<string, int>();

        foreach (var assignment in RegionAssignments(p))
        {
            if (assignment.Date < p.RangeFrom || assignment.Date > p.RangeTo) continue;
            var roleId = AssignmentRoleId(assignment);
            if (roleId is null) continue;
            if (!byPerson.TryGetValue(assignment.PersonId, out var roleCounts)) byPerson[assignment.PersonId] = roleCounts = [];
            roleCounts[roleId] = roleCounts.GetValueOrDefault(roleId) + 1;
            totals[assignment.PersonId] = totals.GetValueOrDefault(assignment.PersonId) + 1;
        }

        foreach (var (personId, roleCounts) in byPerson)
        {
            if (!p.Index.People.TryGetValue(personId, out var person)) continue;
            var total = totals.GetValueOrDefault(personId);
            if (total < MinAssignmentsForShare) continue;

            foreach (var eligibility in person.Eligibility)
            {
                var actual = (double)roleCounts.GetValueOrDefault(eligibility.RoleId) / total;
                if (Math.Abs(actual - eligibility.TargetShare) <= ShareTolerance) continue;
                var role = p.Index.Roles.GetValueOrDefault(eligibility.RoleId);
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Fairness, IssueCode.TargetShareDeviation,
                    $"{person.DisplayName}: {role?.Code ?? eligibility.RoleId} — actual {actual * 100:F0}% vs target {eligibility.TargetShare * 100:F0}%",
                    PersonId: personId, RoleId: eligibility.RoleId));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // Отгулы
    // -------------------------------------------------------------------------

    private static List<IssueDraft> CheckCompDays(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        foreach (var entry in p.CompDays)
        {
            if (!p.Index.People.TryGetValue(entry.PersonId, out var person) || person.RegionId != p.RegionId) continue;
            if (!p.Index.Regions.TryGetValue(person.RegionId, out var region)) continue;

            if (entry.Status == CompDayStatus.PendingApproval)
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.CompDayPendingApproval,
                    $"{person.DisplayName}: comp day for {entry.EarnedForDate:yyyy-MM-dd} has no valid slot and needs approval",
                    entry.EarnedForDate, entry.PersonId));
                continue;
            }

            if (!CompDayIsOutstanding(entry)) continue;
            var age = CompDayService.Age(entry, p.AsOf);
            if (age <= region.CompOffPolicy.AgingThresholdDays) continue;

            drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Policy, IssueCode.CompDayAging,
                $"{person.DisplayName}: comp day earned {entry.EarnedForDate:yyyy-MM-dd} has been outstanding {age} days",
                EffectiveCompDayDate(entry), entry.PersonId));
        }
        return drafts;
    }
}
