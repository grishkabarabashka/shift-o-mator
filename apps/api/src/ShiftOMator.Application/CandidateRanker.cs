using System.Globalization;
using ShiftOMator.Domain;
using static ShiftOMator.Domain.DomainHelpers;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/candidates.ts — shared core of Suggest and Auto-populate (Docs/06).
///
/// Two hard filters, then only ordering:
///   1. eligibility  — the shift is on the person's list;
///   2. availability — not on leave, not a confirmed comp day, not a blackout date,
///                      a weekday inside AvailableWeekdays, the day still free.
/// Survivors sort by:
///   3. 90-day fairness — fewer times holding this shift ranks higher;
///   4. recency — held it recently, pushed down;
///   5. personal limits — over MaxWeekendsPerQuarter or MaxPerWeek demotes, doesn't exclude.
///
/// Pure and deterministic: same input, same order on rerun — otherwise regenerating
/// after one edit would reshuffle the whole month.
/// </summary>
public static class CandidateRanker
{
    private const int FairnessWindowDays = 90;
    private const int WeekendLoadWindowDays = 84; // 12 недель — окно из примера в Docs/06.

    public record Candidate(
        string PersonId, string Name, int ShiftCountLast90, int? DaysSinceLastHeld,
        int WeekendLoad, IReadOnlyList<string> Warnings);

    public record ExcludedCandidate(string PersonId, string Name, string Reason);

    public record CandidateResult(
        IReadOnlyList<Candidate> Available, IReadOnlyList<ExcludedCandidate> Excluded, double TeamWeekendAverage);

    public record RankParams(
        string ShiftId, DateOnly Date, string UnitId, DatasetIndex Index,
        IReadOnlyList<Assignment> Assignments, IReadOnlyList<Absence> Absences, IReadOnlyList<CompDayEntry> CompDays,
        /// <summary>Busy elsewhere today — excluded without an availability reason, since
        /// this is an already-made decision on another question, not unavailability.</summary>
        IReadOnlySet<string>? ExcludePersonIds = null);

    public static CandidateResult Rank(RankParams p)
    {
        var pool = p.Index.People.Values
            .Where(person => person.UnitId == p.UnitId && person.IsIncluded && person.Eligibility.Any(e => e.ShiftId == p.ShiftId))
            .ToList();

        var weekday = DateHelpers.IsoWeekdayOf(p.Date);
        var fairnessSince = p.Date.AddDays(-FairnessWindowDays);
        var weekendSince = p.Date.AddDays(-WeekendLoadWindowDays);
        Location? LocationOf(string personId) =>
            p.Index.People.TryGetValue(personId, out var person) ? p.Index.Locations.GetValueOrDefault(person.LocationId) : null;

        var available = new List<Candidate>();
        var excluded = new List<ExcludedCandidate>();
        var weekendLoads = new List<int>();

        foreach (var person in pool)
        {
            // Занят другой ролью в этот же день — не «не eligible» (см. класс doc).
            if (p.ExcludePersonIds?.Contains(person.Id) == true)
            {
                excluded.Add(new ExcludedCandidate(person.Id, person.DisplayName, "already assigned to something else that day"));
                continue;
            }

            var reason = AvailabilityBlockReason(person, p.Date, weekday, p.Absences, p.CompDays);
            if (reason is not null)
            {
                excluded.Add(new ExcludedCandidate(person.Id, person.DisplayName, reason));
                continue;
            }

            var own = p.Assignments.Where(a => a.PersonId == person.Id).ToList();
            var shiftCountLast90 = own.Count(a =>
                a.ContentKind == AssignmentContentKind.Shift && a.ShiftId == p.ShiftId && a.Date >= fairnessSince && a.Date < p.Date);

            var lastHeld = own
                .Where(a => a.ContentKind == AssignmentContentKind.Shift && a.ShiftId == p.ShiftId && a.Date < p.Date)
                .Select(a => a.Date)
                .OrderBy(d => d)
                .Cast<DateOnly?>()
                .LastOrDefault();
            var daysSinceLastHeld = lastHeld is not null ? DateHelpers.DaysBetween(lastHeld.Value, p.Date) : (int?)null;

            var loc = LocationOf(person.Id);
            var weekendLoad = loc is not null
                ? own.Count(a => a.Date >= weekendSince && a.Date < p.Date && DateHelpers.IsWeekendIn(a.Date, loc))
                : 0;
            weekendLoads.Add(weekendLoad);

            var warnings = new List<string>();
            var eligibility = person.Eligibility.FirstOrDefault(e => e.ShiftId == p.ShiftId);
            var isWeekendDate = loc is not null && DateHelpers.IsWeekendIn(p.Date, loc);

            if (isWeekendDate && person.Constraints.MaxWeekendsPerQuarter is int maxWeekends)
            {
                var quarterCount = own.Count(a => loc is not null && DateHelpers.IsWeekendIn(a.Date, loc) && SameQuarter(a.Date, p.Date));
                if (quarterCount >= maxWeekends) warnings.Add($"would exceed {maxWeekends} weekends this quarter");
            }

            if (eligibility?.MaxPerWeek is int maxPerWeek)
            {
                var weekCount = own.Count(a => SameIsoWeek(a.Date, p.Date));
                if (weekCount >= maxPerWeek) warnings.Add($"would exceed {maxPerWeek} shifts this week");
            }

            if (person.Preferences?.AvoidsWeekdays?.Contains(weekday) == true) warnings.Add("prefers to avoid this weekday");

            available.Add(new Candidate(person.Id, person.DisplayName, shiftCountLast90, daysSinceLastHeld, weekendLoad, warnings));
        }

        available = [.. available
            // Меньше — важнее: сначала кто реже держал роль в окне.
            .OrderBy(c => c.ShiftCountLast90)
            // Дальше — кто держал её давнее (или никогда): недавний держатель отодвигается.
            .ThenByDescending(c => c.DaysSinceLastHeld ?? int.MaxValue)
            // Предупреждения понижают, но не исключают.
            .ThenBy(c => c.Warnings.Count)
            // Устойчивый порядок на полном равенстве.
            .ThenBy(c => c.PersonId, StringComparer.Ordinal)];

        var teamWeekendAverage = weekendLoads.Count > 0 ? Math.Round(weekendLoads.Average(), 1) : 0;

        return new CandidateResult(available, excluded, teamWeekendAverage);
    }

    /// <summary>
    /// Hard availability filter, separate from eligibility. Reused by auto-populate for
    /// default shifts so there's one absence/comp-day/blackout/weekday rule, not two that
    /// eventually drift.
    /// </summary>
    public static string? AvailabilityBlockReason(
        Person person, DateOnly date, IsoWeekday weekday, IReadOnlyList<Absence> absences, IReadOnlyList<CompDayEntry> compDays)
    {
        var absence = absences.FirstOrDefault(a => a.PersonId == person.Id && date >= a.From && date <= a.To);
        if (absence is not null) return AbsenceReasonLabel(absence.Type);

        var onCompDay = compDays.Any(entry =>
            entry.PersonId == person.Id && CompDayBlocksAssignment(entry) && EffectiveCompDayDate(entry) == date);
        if (onCompDay) return "on a confirmed comp day";

        if (person.Preferences?.BlackoutDates?.Contains(date) == true) return "blackout date";

        if (!person.AvailableWeekdays.Contains(weekday)) return "not available this weekday";

        return null;
    }

    private static string AbsenceReasonLabel(AbsenceType type) => type switch
    {
        AbsenceType.Vacation => "on leave",
        AbsenceType.Sick => "out sick",
        _ => "absent",
    };

    private static bool SameIsoWeek(DateOnly a, DateOnly b) =>
        ISOWeek.GetYear(a.ToDateTime(TimeOnly.MinValue)) == ISOWeek.GetYear(b.ToDateTime(TimeOnly.MinValue)) &&
        ISOWeek.GetWeekOfYear(a.ToDateTime(TimeOnly.MinValue)) == ISOWeek.GetWeekOfYear(b.ToDateTime(TimeOnly.MinValue));

    private static bool SameQuarter(DateOnly a, DateOnly b) =>
        a.Year == b.Year && (a.Month - 1) / 3 == (b.Month - 1) / 3;
}
