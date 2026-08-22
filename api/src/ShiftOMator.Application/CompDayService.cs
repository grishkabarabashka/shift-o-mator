using ShiftOMator.Domain;
using static ShiftOMator.Domain.DomainHelpers;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/compDays.ts. The date is found by a *window search*, not a fixed
/// offset — an offset gives the wrong date the moment the target day is occupied,
/// excluded, or itself non-working. No free day in the window means PENDING_APPROVAL,
/// never silence.
///
/// Comp days never expire. An age threshold flags what's hung around too long instead.
/// Non-working is judged by the *person's location* calendar (ADR-0002), not the role's.
/// </summary>
public static class CompDayService
{
    /// <summary>Which policy rule fires on this day. Null = a working day, no accrual.</summary>
    public static CompDayTrigger? TriggerFor(DateOnly date, string personLocationId, DatasetIndex index)
    {
        if (!index.Locations.TryGetValue(personLocationId, out var location))
            throw new InvalidOperationException($"Location {personLocationId} not found");
        if (DateHelpers.IsHolidayIn(date, location, index)) return CompDayTrigger.Holiday;
        if (!DateHelpers.IsWeekendIn(date, location)) return null;
        return DateHelpers.IsoWeekdayOf(date) == IsoWeekday.Sunday ? CompDayTrigger.Sunday : CompDayTrigger.Saturday;
    }

    public record SlotSearchInput(
        string PersonId,
        DateOnly EarnedForDate,
        CompOffPolicy Policy,
        DatasetIndex Index,
        IReadOnlyList<Absence> Absences,
        IReadOnlySet<DateOnly> OccupiedDates);

    /// <summary>
    /// The earliest free eligible date in the window. Search radiates from the earned
    /// date outward, nearest-after first, then nearest-before — a comp day next to the
    /// worked day is more useful than one two weeks out.
    /// </summary>
    public static DateOnly? FindSlot(SlotSearchInput input)
    {
        if (!input.Index.People.TryGetValue(input.PersonId, out var person)) return null;
        if (!input.Index.Locations.TryGetValue(person.LocationId, out var location)) return null;

        bool IsFree(DateOnly date)
        {
            if (input.Policy.ExcludedWeekdays.Contains(DateHelpers.IsoWeekdayOf(date))) return false;
            if (DateHelpers.IsWeekendIn(date, location) || DateHelpers.IsHolidayIn(date, location, input.Index)) return false;
            if (input.OccupiedDates.Contains(date)) return false;
            if (input.Index.AssignmentsByCell.ContainsKey(DatasetIndex.CellKey(input.PersonId, date))) return false;
            if (input.Absences.Any(a => a.PersonId == input.PersonId && date >= a.From && date <= a.To)) return false;
            return true;
        }

        var maxOffset = Math.Max(input.Policy.WindowAfterDays, input.Policy.WindowBeforeDays);
        for (var offset = 1; offset <= maxOffset; offset++)
        {
            if (offset <= input.Policy.WindowAfterDays)
            {
                var after = input.EarnedForDate.AddDays(offset);
                if (IsFree(after)) return after;
            }
            if (offset <= input.Policy.WindowBeforeDays)
            {
                var before = input.EarnedForDate.AddDays(-offset);
                if (IsFree(before)) return before;
            }
        }
        return null;
    }

    public record ProposeParams(
        DateOnly RangeFrom,
        DateOnly RangeTo,
        IReadOnlyList<Assignment> Assignments,
        IReadOnlyList<Absence> Absences,
        IReadOnlyList<CompDayEntry> Existing,
        DatasetIndex Index,
        /// <summary>Restrict accrual to these assignments — see remarks on Propose.</summary>
        IReadOnlySet<string>? ScopeAssignmentIds = null);

    public record ProposeResult(
        IReadOnlyList<CompDayEntry> Entries,
        IReadOnlyList<CompDayEntry> Added,
        IReadOnlyList<CompDayEntry> Orphaned);

    /// <summary>
    /// Recomputes accrual over a period. Planner decisions are never overwritten — a
    /// comp day already moved stays moved.
    ///
    /// <paramref name="ProposeParams.ScopeAssignmentIds"/>: without a scope, one cell
    /// edit would sweep up every unprocessed weekend in the period and attribute it to
    /// the planner — 29 changes for one click. An edit owns only what it touched.
    /// Orphan detection still scans the whole set, or orphans would get lost.
    /// </summary>
    public static ProposeResult Propose(ProposeParams p)
    {
        var byAssignment = p.Existing.ToDictionary(e => e.EarnedForAssignmentId);

        var occupiedDates = new Dictionary<string, HashSet<DateOnly>>();
        foreach (var entry in p.Existing)
        {
            var date = EffectiveCompDayDate(entry);
            if (date is null || !CompDayIsOutstanding(entry)) continue;
            if (!occupiedDates.TryGetValue(entry.PersonId, out var bucket)) occupiedDates[entry.PersonId] = bucket = [];
            bucket.Add(date.Value);
        }

        var liveAssignmentIds = new HashSet<string>();
        var added = new List<CompDayEntry>();

        // Порядок обхода фиксирован: результат не должен зависеть от порядка входа.
        var ordered = p.Assignments.OrderBy(a => a.Date).ThenBy(a => a.Id, StringComparer.Ordinal);

        foreach (var assignment in ordered)
        {
            if (assignment.Date < p.RangeFrom || assignment.Date > p.RangeTo) continue;
            if (!IsWorkingAssignment(assignment)) continue;
            liveAssignmentIds.Add(assignment.Id);
            if (byAssignment.ContainsKey(assignment.Id)) continue;
            if (p.ScopeAssignmentIds is not null && !p.ScopeAssignmentIds.Contains(assignment.Id)) continue;

            if (!p.Index.People.TryGetValue(assignment.PersonId, out var person)) continue;
            if (!p.Index.Regions.TryGetValue(person.RegionId, out var region)) continue;

            var trigger = TriggerFor(assignment.Date, person.LocationId, p.Index);
            if (trigger is null) continue;

            if (!occupiedDates.TryGetValue(person.Id, out var occupied)) occupiedDates[person.Id] = occupied = [];
            var slot = FindSlot(new SlotSearchInput(
                person.Id, assignment.Date, region.CompOffPolicy, p.Index, p.Absences, occupied));

            var entry = new CompDayEntry
            {
                Id = $"cd-{assignment.Id}",
                PersonId = person.Id,
                EarnedForAssignmentId = assignment.Id,
                EarnedForDate = assignment.Date,
                Trigger = trigger.Value,
                ProposedDate = slot,
                Status = slot is not null ? CompDayStatus.Proposed : CompDayStatus.PendingApproval,
            };

            if (slot is not null) occupied.Add(slot.Value);
            added.Add(entry);
        }

        var orphaned = p.Existing
            .Where(e => e.EarnedForDate >= p.RangeFrom && e.EarnedForDate <= p.RangeTo && !liveAssignmentIds.Contains(e.EarnedForAssignmentId))
            .ToList();

        return new ProposeResult([.. p.Existing, .. added], added, orphaned);
    }

    // -------------------------------------------------------------------------
    // Баланс и возраст
    // -------------------------------------------------------------------------

    public record CompDayBalance(
        string PersonId, int Earned, int Proposed, int Scheduled, int Taken,
        int PendingApproval, int Declined, int Due, int Aged);

    public static int Age(CompDayEntry entry, DateOnly asOf) => DateHelpers.DaysBetween(entry.EarnedForDate, asOf);

    public static bool IsAged(CompDayEntry entry, DateOnly asOf, int thresholdDays) =>
        CompDayIsOutstanding(entry) && Age(entry, asOf) > thresholdDays;

    public static CompDayBalance Balance(string personId, IReadOnlyList<CompDayEntry> entries, DateOnly asOf, int agingThresholdDays)
    {
        int earned = 0, proposed = 0, scheduled = 0, taken = 0, pendingApproval = 0, declined = 0, aged = 0;
        foreach (var entry in entries)
        {
            if (entry.PersonId != personId) continue;
            earned++;
            switch (entry.Status)
            {
                case CompDayStatus.Proposed: proposed++; break;
                case CompDayStatus.Scheduled: scheduled++; break;
                case CompDayStatus.Taken: taken++; break;
                case CompDayStatus.PendingApproval: pendingApproval++; break;
                case CompDayStatus.Declined: declined++; break;
            }
            if (IsAged(entry, asOf, agingThresholdDays)) aged++;
        }
        return new CompDayBalance(personId, earned, proposed, scheduled, taken, pendingApproval, declined,
            Due: proposed + scheduled + pendingApproval, aged);
    }

    /// <summary>Dates in the range a person has a confirmed comp day on.</summary>
    public static HashSet<DateOnly> BlockedDates(string personId, IReadOnlyList<CompDayEntry> entries, DateOnly rangeFrom, DateOnly rangeTo)
    {
        var dates = new HashSet<DateOnly>();
        foreach (var entry in entries)
        {
            if (entry.PersonId != personId) continue;
            if (entry.Status is not (CompDayStatus.Scheduled or CompDayStatus.Taken)) continue;
            var date = EffectiveCompDayDate(entry);
            if (date is not null && date >= rangeFrom && date <= rangeTo) dates.Add(date.Value);
        }
        return dates;
    }
}
