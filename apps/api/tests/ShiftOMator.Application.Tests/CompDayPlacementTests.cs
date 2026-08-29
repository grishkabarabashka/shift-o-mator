using ShiftOMator.Application;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Which day an engineer may take an earned comp day on (ADR-0052).
///
/// The auto-placed proposal is a default, not the answer: the engineer picks, an approver
/// signs off. These rules decide only the set they may pick from — and they live in one
/// place so the dates the client offers and the dates the server accepts cannot drift.
/// </summary>
public class CompDayPlacementTests
{
    private static readonly DateOnly Earned = new(2026, 9, 12); // a Saturday

    private static CompDayEntry Entry(CompDayStatus status = CompDayStatus.Proposed) => new()
    {
        Id = "cd-1",
        PersonId = "p-alice",
        EarnedForAssignmentId = "as-1",
        EarnedForDate = Earned,
        Trigger = CompDayTrigger.Saturday,
        ProposedDate = new DateOnly(2026, 9, 16),
        Status = status,
    };

    private static CompOffPolicy Policy() => new()
    {
        WindowBeforeDays = 7,
        WindowAfterDays = 30,
        ExcludedWeekdays = [IsoWeekday.Monday, IsoWeekday.Friday],
        AgingThresholdDays = 14,
    };

    [Fact]
    public void A_wednesday_inside_the_window_is_allowed()
    {
        Assert.Null(CompDayPlacement.Check(Entry(), new DateOnly(2026, 9, 16), Policy(), []));
    }

    [Fact]
    public void A_date_past_the_window_is_refused()
    {
        var refusal = CompDayPlacement.Check(Entry(), new DateOnly(2026, 11, 4), Policy(), []);
        Assert.Equal("OUTSIDE_WINDOW", refusal?.Code);
    }

    [Fact]
    public void A_date_before_the_window_is_refused()
    {
        // The window reaches backwards too: a day taken in advance of the weekend worked
        // is a normal arrangement, but not an unbounded one.
        var refusal = CompDayPlacement.Check(Entry(), new DateOnly(2026, 8, 1), Policy(), []);
        Assert.Equal("OUTSIDE_WINDOW", refusal?.Code);
    }

    [Fact]
    public void An_excluded_weekday_is_refused()
    {
        // Monday and Friday by default: a comp day next to a weekend is a long weekend,
        // which is a different thing from the day off in lieu that was earned.
        var refusal = CompDayPlacement.Check(Entry(), new DateOnly(2026, 9, 18), Policy(), []);
        Assert.Equal("EXCLUDED_WEEKDAY", refusal?.Code);
    }

    [Fact]
    public void A_sunday_is_matched_as_iso_seven_not_zero()
    {
        // `DayOfWeek` counts Sunday as 0 and ISO counts it as 7; getting that wrong maps
        // Sunday onto Monday and refuses the wrong day.
        var policy = Policy();
        policy.ExcludedWeekdays = [IsoWeekday.Sunday];

        Assert.Equal("EXCLUDED_WEEKDAY",
            CompDayPlacement.Check(Entry(), new DateOnly(2026, 9, 20), policy, [])?.Code);
        Assert.Null(CompDayPlacement.Check(Entry(), new DateOnly(2026, 9, 21), policy, []));
    }

    [Fact]
    public void A_day_the_person_is_already_off_is_refused()
    {
        var refusal = CompDayPlacement.Check(
            Entry(), new DateOnly(2026, 9, 16), Policy(), [new DateOnly(2026, 9, 16)]);
        Assert.Equal("ALREADY_NON_WORKING", refusal?.Code);
    }

    [Fact]
    public void An_already_taken_comp_day_cannot_be_moved()
    {
        var refusal = CompDayPlacement.Check(
            Entry(CompDayStatus.Taken), new DateOnly(2026, 9, 16), Policy(), []);
        Assert.Equal("COMP_DAY_TAKEN", refusal?.Code);
    }

    [Fact]
    public void A_scheduled_comp_day_can_still_be_moved()
    {
        // Plans change, and the accrual is not consumed until it is actually taken.
        Assert.Null(CompDayPlacement.Check(
            Entry(CompDayStatus.Scheduled), new DateOnly(2026, 9, 16), Policy(), []));
    }
}
