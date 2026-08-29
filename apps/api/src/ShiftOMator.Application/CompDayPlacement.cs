using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Whether an engineer may take an earned comp day on a given date (ADR-0052).
///
/// WHY the rules live here and not in the endpoint: the same question is asked twice, from
/// two directions — the client greys out the dates it will not offer, and the server
/// refuses the ones it is asked for anyway. Two implementations of "within the window,
/// not on an excluded weekday" would disagree the first time either was edited, and the
/// disagreement would show up as a date the UI offered and the server rejected.
///
/// The auto-placed <see cref="CompDayEntry.ProposedDate"/> is a default, not the answer:
/// the engineer picks the day, and an approver signs it off. What this function decides is
/// only the set they may pick from.
/// </summary>
public static class CompDayPlacement
{
    public sealed record Refusal(string Code, string Message);

    /// <summary>Null when the date is allowed.</summary>
    public static Refusal? Check(
        CompDayEntry entry,
        DateOnly requested,
        CompOffPolicy policy,
        IReadOnlyCollection<DateOnly> personsNonWorkingDates)
    {
        if (entry.Status == CompDayStatus.Taken)
            return new Refusal("COMP_DAY_TAKEN", "That comp day has already been taken.");

        if (entry.Status == CompDayStatus.Declined)
            return new Refusal("COMP_DAY_DECLINED", "That comp day was declined and cannot be placed.");

        var earliest = entry.EarnedForDate.AddDays(-policy.WindowBeforeDays);
        var latest = entry.EarnedForDate.AddDays(policy.WindowAfterDays);
        if (requested < earliest || requested > latest)
        {
            return new Refusal("OUTSIDE_WINDOW",
                $"A comp day for {entry.EarnedForDate:yyyy-MM-dd} has to fall between "
                + $"{earliest:yyyy-MM-dd} and {latest:yyyy-MM-dd}.");
        }

        // Mondays and Fridays by default: a comp day next to a weekend turns into a long
        // weekend, which is a different thing from the day off in lieu that was earned.
        // `DayOfWeek` counts Sunday as 0; ISO counts it as 7.
        var weekday = requested.DayOfWeek == DayOfWeek.Sunday
            ? IsoWeekday.Sunday
            : (IsoWeekday)(int)requested.DayOfWeek;
        if (policy.ExcludedWeekdays.Contains(weekday))
            return new Refusal("EXCLUDED_WEEKDAY", $"{requested.DayOfWeek} is not offered for comp days.");

        // A comp day on a day already not worked gives nothing back.
        if (personsNonWorkingDates.Contains(requested))
            return new Refusal("ALREADY_NON_WORKING", "That day is already a non-working day.");

        return null;
    }
}
