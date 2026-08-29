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
/// or a shift handed out off-eligibility during a crunch, are decisions made in reality;
/// the system must record, highlight and remember the reason, not refuse to save.
/// Only records that cannot be right under any decision stay BLOCKING: two assignments
/// on the same day, and a shift that doesn't exist or belongs to another unit.
/// </summary>
public static class Validator
{
    public record ValidateParams(
        string UnitId,
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
        DateOnly? Date = null, string? PersonId = null, string? ShiftId = null);

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

    private static Issue MakeIssue(string unitId, IssueDraft d)
    {
        // SCREAMING_SNAKE_CASE, matching the TypeScript client's IssueCode string
        // literals exactly — Issue.Key is compared byte-for-byte against the client's
        // in the engine differential test, and will be the wire format once the API
        // serves this (Phase 5).
        var key = string.Join('|', IssueCodeWireName(d.Code), d.Date?.ToString("yyyy-MM-dd") ?? "", d.PersonId ?? "", d.ShiftId ?? "");
        return new Issue
        {
            Key = key, Level = d.Level, Category = d.Category, Code = d.Code, Message = d.Message,
            UnitId = unitId, Date = d.Date, PersonId = d.PersonId, ShiftId = d.ShiftId,
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
            .Select(d => MakeIssue(p.UnitId, d))
            .OrderBy(i => LevelOrder[i.Level])
            .ThenBy(i => i.Date?.ToString("yyyy-MM-dd") ?? "", StringComparer.Ordinal)
            .ThenBy(i => i.Key, StringComparer.Ordinal)
            .ToList();
    }

    public static HashSet<string> AcknowledgedKeys(IEnumerable<Acknowledgement> acks) =>
        acks.Select(a => a.IssueKey).ToHashSet();

    /// <summary>No BLOCKING (ADR-0037, owner review): an unacknowledged warning is a
    /// signal, not corrupt data, and stopped being a publish gate for the same reason
    /// a gap did (ADR-0035). Only a double assignment and an unknown/ineligible shift
    /// still block.</summary>
    public static bool CanPublish(IReadOnlyList<Issue> issues) =>
        !issues.Any(i => i.Level == IssueLevel.Blocking);

    public record IssueSummary(int Blocking, int Gaps, int Conflicts, int Warning, int Info, int UnacknowledgedWarnings);

    public static IssueSummary Summarize(IReadOnlyList<Issue> issues, IReadOnlySet<string> acknowledged)
    {
        int blocking = 0, gaps = 0, conflicts = 0, warning = 0, info = 0, unacknowledged = 0;
        foreach (var issue in issues)
        {
            // NOTE: Category is counted independently of level: a conflict stays a
            // conflict even once it's acknowledgeable rather than blocking (ADR-0024).
            // Same for a gap — CoverageGap became INFO (ADR-0035), but it's still
            // counted as a gap by code, not by level, or the counter would have
            // dropped to zero along with the blocking status.
            if (issue.Category == IssueCategory.Conflict) conflicts++;
            if (issue.Code == IssueCode.CoverageGap) gaps++;

            if (issue.Level == IssueLevel.Blocking)
            {
                blocking++;
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
    // SECTION: Coverage
    // -------------------------------------------------------------------------

    private static List<IssueDraft> CheckCoverage(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        foreach (var cell in p.CoverageCells)
        {
            var code = p.Index.Shifts.GetValueOrDefault(cell.ShiftId)?.Code ?? cell.ShiftId;
            var label = cell.RuleLabel is not null ? $" ({cell.RuleLabel})" : "";

            if (cell.Level == CoverageLevel.Gap)
            {
                // NOTE: INFO, not BLOCKING (ADR-0035, owner review): gaps are shown and
                // highlighted everywhere, but a real gap in a real roster is a
                // decision to publish and keep working on, not data the system
                // gets to refuse to save. Stays Category.Gap — it's still a gap,
                // just no longer one of the two things that can block (ADR-0009 §11:
                // only a double assignment and an unknown/ineligible shift do).
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Gap, IssueCode.CoverageGap,
                    $"{code}{label}: {cell.Actual} assigned, minimum is {cell.Min}", cell.Date, ShiftId: cell.ShiftId));
            }
            else if (cell.Level == CoverageLevel.Thin)
            {
                // NOTE: INFO, not WARNING — working right at the minimum is normal,
                // not a deviation.
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Gap, IssueCode.CoverageThin,
                    $"{code}{label}: {cell.Actual} assigned, exactly at the minimum — no slack", cell.Date, ShiftId: cell.ShiftId));
            }
            else if (cell.Level == CoverageLevel.Over && cell.Max is not null)
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.CoverageOverMax,
                    $"{code}{label}: {cell.Actual} assigned, maximum is {cell.Max}", cell.Date, ShiftId: cell.ShiftId));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // SECTION: Assignments
    // -------------------------------------------------------------------------

    private static List<Assignment> UnitAssignments(ValidateParams p) =>
        p.Assignments.Where(a => p.Index.People.TryGetValue(a.PersonId, out var person) && person.UnitId == p.UnitId).ToList();

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

        foreach (var assignment in UnitAssignments(p))
        {
            if (assignment.Date < p.RangeFrom || assignment.Date > p.RangeTo) continue;
            if (!p.Index.People.TryGetValue(assignment.PersonId, out var person)) continue;

            var key = DatasetIndex.CellKey(person.Id, assignment.Date);
            if (!seenCell.Add(key))
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.DoubleAssignment,
                    $"{person.DisplayName}: more than one assignment on the same day", assignment.Date, person.Id));
            }


            var shiftId = assignment.ShiftId;
            var shift = shiftId is not null ? p.Index.Shifts.GetValueOrDefault(shiftId) : null;

            if (shift is null)
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.ShiftOutsideRegion,
                    $"Role {shiftId ?? "?"} does not exist", assignment.Date, person.Id));
                continue;
            }

            if (shift.UnitId != person.UnitId)
            {
                drafts.Add(new IssueDraft(IssueLevel.Blocking, IssueCategory.Conflict, IssueCode.ShiftOutsideRegion,
                    $"{person.DisplayName}: shift {shift.Code} belongs to another unit", assignment.Date, person.Id, shift.Id));
            }
            else if (!person.Eligibility.Any(e => e.ShiftId == shift.Id))
            {
                // NOTE: Not a blocker — a crunch gets covered by whoever's available,
                // and a deliberate departure from eligibility is fine once
                // acknowledged (ADR-0024).
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.ShiftNotEligible,
                    $"{person.DisplayName}: shift {shift.Code} is outside their eligibility", assignment.Date, person.Id, shift.Id));
            }
            else
            {
                var config = DayConfigurationResolver.Resolve(p.UnitId, assignment.Date, p.Index);
                var inConfig = config?.ShiftRequirements.Any(r => r.ShiftId == shift.Id) ?? false;
                if (!inConfig)
                {
                    drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.ShiftNotInDayConfig,
                        $"{person.DisplayName}: shift {shift.Code} is not part of this day's configuration", assignment.Date, person.Id, shift.Id));
                }
            }

            var absence = absencesByPerson.GetValueOrDefault(person.Id)?.FirstOrDefault(a => assignment.Date >= a.From && assignment.Date <= a.To);
            if (absence is not null)
            {
                // NOTE: Not a blocker — either the person is coming in during their
                // own leave, or the record is stale; the planner resolves both cases,
                // not the validator.
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.AssignedDuringAbsence,
                    $"{person.DisplayName}: assigned during {AbsenceLabel(absence, p.Index)}", assignment.Date, person.Id, shift.Id));
            }

            if (blockingCompDays.ContainsKey(key))
            {
                // NOTE: Not a blocker — the comp day gets rescheduled, the record
                // stays visible; a comp day never expires (ADR-0007).
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Conflict, IssueCode.AssignedDuringCompDay,
                    $"{person.DisplayName}: assigned on a confirmed comp day", assignment.Date, person.Id, shift.Id));
            }

            if (!person.AvailableWeekdays.Contains(DateHelpers.IsoWeekdayOf(assignment.Date)))
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.UnavailableWeekday,
                    $"{person.DisplayName}: weekday outside availability", assignment.Date, person.Id, shift.Id));
            }

            if (person.Preferences?.AvoidsWeekdays?.Contains(DateHelpers.IsoWeekdayOf(assignment.Date)) == true)
            {
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Policy, IssueCode.PreferenceViolated,
                    $"{person.DisplayName}: a day this person prefers to avoid", assignment.Date, person.Id, shift.Id));
            }
        }

        return drafts;
    }

    private static string AbsenceLabel(Absence absence, DatasetIndex index)
    {
        var label = index.EventTypes.TryGetValue(absence.EventTypeId, out var type)
            ? type.Label.ToLowerInvariant()
            : "an absence";
        return absence.Portion switch
        {
            DayPortion.Morning => $"{label} (morning)",
            DayPortion.Afternoon => $"{label} (afternoon)",
            _ => label,
        };
    }

    // -------------------------------------------------------------------------
    // SECTION: Rest and consecutive days
    // -------------------------------------------------------------------------

    private record DatedInterval(DateOnly Date, UtcInterval Interval);

    private static Dictionary<string, List<DatedInterval>> IntervalsByPerson(ValidateParams p)
    {
        var result = new Dictionary<string, List<DatedInterval>>();
        foreach (var assignment in UnitAssignments(p))
        {
            var shiftId = assignment.ShiftId;
            if (shiftId is null) continue;
            if (!p.Index.Shifts.TryGetValue(shiftId, out var shift)) continue;
            UtcInterval interval;
            try
            {
                interval = DateHelpers.ShiftInterval(shift, assignment.Date, assignment.TimeOverride);
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
        foreach (var assignment in UnitAssignments(p))
        {
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
    // SECTION: Weekend load
    // -------------------------------------------------------------------------

    private const int QuarterWindowDays = 91;

    private static List<IssueDraft> CheckWeekendLoad(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var datesByPerson = new Dictionary<string, List<DateOnly>>();
        foreach (var assignment in UnitAssignments(p))
        {
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
    // SECTION: Concurrent-absence limits
    // -------------------------------------------------------------------------

    private record AbsenceSpan(string PersonId, string? EventTypeId, bool IsCompDay, DateOnly From, DateOnly To, int Workdays);

    private static List<AbsenceSpan> AbsenceSpans(ValidateParams p)
    {
        var spans = new List<AbsenceSpan>();

        Location? LocationOf(string personId)
        {
            if (!p.Index.People.TryGetValue(personId, out var person) || person.UnitId != p.UnitId) return null;
            return p.Index.Locations.GetValueOrDefault(person.LocationId);
        }

        foreach (var absence in p.Absences)
        {
            var location = LocationOf(absence.PersonId);
            if (location is null) continue;
            spans.Add(new AbsenceSpan(absence.PersonId, absence.EventTypeId, false, absence.From, absence.To,
                DateHelpers.CountWorkdays(absence.From, absence.To, location, p.Index)));
        }

        // NOTE: A confirmed comp day occupies the person the same way vacation does.
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
        var rules = p.AbsenceCapacityRules.Where(r => r.UnitId == p.UnitId).ToList();
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
                    else if (span.EventTypeId is null || !rule.CountsEventTypeIds.Contains(span.EventTypeId)) return false;

                    var isLong = span.Workdays >= rule.LongThresholdWorkdays;
                    if (rule.DurationBucket == AbsenceDurationBucket.Long && !isLong) return false;
                    if (rule.DurationBucket == AbsenceDurationBucket.Short && isLong) return false;
                    if (rule.ScopeKind == AbsenceCapacityScopeKind.Unit) return true;

                    var person = p.Index.People.GetValueOrDefault(span.PersonId);
                    return person?.Eligibility.Any(e => e.ShiftId == rule.ScopeShiftId) ?? false;
                }).ToList();

                if (matching.Count <= rule.MaxConcurrent) continue;

                var scopeLabel = rule.ScopeKind == AbsenceCapacityScopeKind.Unit
                    ? "unit-wide"
                    : $"in the {p.Index.Shifts.GetValueOrDefault(rule.ScopeShiftId ?? "")?.Code ?? rule.ScopeShiftId} pool";
                var bucketLabel = rule.DurationBucket == AbsenceDurationBucket.Long ? "long" : "short";

                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.AbsenceCapacityExceeded,
                    $"{matching.Count} {bucketLabel} absences {scopeLabel}, limit is {rule.MaxConcurrent}", date,
                    ShiftId: rule.ScopeKind == AbsenceCapacityScopeKind.ShiftPool ? rule.ScopeShiftId : null));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // SECTION: Target role shares
    // -------------------------------------------------------------------------

    private const int MinAssignmentsForShare = 5;
    private const double ShareTolerance = 0.25;

    private static List<IssueDraft> CheckTargetShares(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        var byPerson = new Dictionary<string, Dictionary<string, int>>();
        var totals = new Dictionary<string, int>();

        foreach (var assignment in UnitAssignments(p))
        {
            if (assignment.Date < p.RangeFrom || assignment.Date > p.RangeTo) continue;
            var shiftId = assignment.ShiftId;
            if (shiftId is null) continue;
            if (!byPerson.TryGetValue(assignment.PersonId, out var shiftCounts)) byPerson[assignment.PersonId] = shiftCounts = [];
            shiftCounts[shiftId] = shiftCounts.GetValueOrDefault(shiftId) + 1;
            totals[assignment.PersonId] = totals.GetValueOrDefault(assignment.PersonId) + 1;
        }

        foreach (var (personId, shiftCounts) in byPerson)
        {
            if (!p.Index.People.TryGetValue(personId, out var person)) continue;
            var total = totals.GetValueOrDefault(personId);
            if (total < MinAssignmentsForShare) continue;

            foreach (var eligibility in person.Eligibility)
            {
                var actual = (double)shiftCounts.GetValueOrDefault(eligibility.ShiftId) / total;
                if (Math.Abs(actual - eligibility.TargetShare) <= ShareTolerance) continue;
                var shift = p.Index.Shifts.GetValueOrDefault(eligibility.ShiftId);
                drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Fairness, IssueCode.TargetShareDeviation,
                    $"{person.DisplayName}: {shift?.Code ?? eligibility.ShiftId} — actual {actual * 100:F0}% vs target {eligibility.TargetShare * 100:F0}%",
                    PersonId: personId, ShiftId: eligibility.ShiftId));
            }
        }
        return drafts;
    }

    // -------------------------------------------------------------------------
    // SECTION: Comp days
    // -------------------------------------------------------------------------

    private static List<IssueDraft> CheckCompDays(ValidateParams p)
    {
        var drafts = new List<IssueDraft>();
        foreach (var entry in p.CompDays)
        {
            if (!p.Index.People.TryGetValue(entry.PersonId, out var person) || person.UnitId != p.UnitId) continue;
            if (!p.Index.Units.TryGetValue(person.UnitId, out var unit)) continue;

            if (entry.Status == CompDayStatus.PendingApproval)
            {
                drafts.Add(new IssueDraft(IssueLevel.Warning, IssueCategory.Policy, IssueCode.CompDayPendingApproval,
                    $"{person.DisplayName}: comp day for {entry.EarnedForDate:yyyy-MM-dd} has no valid slot and needs approval",
                    entry.EarnedForDate, entry.PersonId));
                continue;
            }

            if (!CompDayIsOutstanding(entry)) continue;
            var age = CompDayService.Age(entry, p.AsOf);
            if (age <= unit.CompOffPolicy.AgingThresholdDays) continue;

            drafts.Add(new IssueDraft(IssueLevel.Info, IssueCategory.Policy, IssueCode.CompDayAging,
                $"{person.DisplayName}: comp day earned {entry.EarnedForDate:yyyy-MM-dd} has been outstanding {age} days",
                EffectiveCompDayDate(entry), entry.PersonId));
        }
        return drafts;
    }
}
