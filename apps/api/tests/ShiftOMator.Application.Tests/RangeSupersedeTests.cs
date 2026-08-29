using ShiftOMator.Application;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// What happens to the records already covering a day when a new one arrives (ADR-0052).
///
/// The defect: approving "remote on Wednesday" over an existing "office Mon–Fri" *added* a
/// second record and the cell rendered whichever the projection reached last. The day did
/// not change, which is the one thing the approval was for.
/// </summary>
public class RangeSupersedeTests
{
    private static PresenceRecord Office(string from, string to, DayPortion portion = DayPortion.Full) => new()
    {
        Id = $"pr-{from}",
        PersonId = "p-alice",
        TypeId = PresenceTypeIds.Office,
        From = DateOnly.Parse(from),
        To = DateOnly.Parse(to),
        Portion = portion,
        CreatedBy = "p-alice",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static RangeSupersede.Plan<PresenceRecord> Against(
        IReadOnlyList<PresenceRecord> existing, string from, string to,
        DayPortion portion = DayPortion.Full) =>
        RangeSupersede.Against(
            existing, DateOnly.Parse(from), DateOnly.Parse(to), portion,
            p => p.From, p => p.To, p => p.Portion,
            (p, f, t) => { p.From = f; p.To = t; });

    [Fact]
    public void A_day_punched_out_of_a_week_splits_it_in_two()
    {
        var week = Office("2026-09-07", "2026-09-11"); // Mon–Fri
        var plan = Against([week], "2026-09-09", "2026-09-09"); // Wednesday

        Assert.Empty(plan.Removed);
        Assert.Equal([week], plan.Trimmed);
        // The head keeps Mon–Tue…
        Assert.Equal(DateOnly.Parse("2026-09-07"), week.From);
        Assert.Equal(DateOnly.Parse("2026-09-08"), week.To);
        // …and the tail Thu–Fri becomes a new record.
        var (source, from, to) = Assert.Single(plan.Split);
        Assert.Equal(week, source);
        Assert.Equal(DateOnly.Parse("2026-09-10"), from);
        Assert.Equal(DateOnly.Parse("2026-09-11"), to);
    }

    [Fact]
    public void A_fully_covered_record_is_removed_rather_than_trimmed_to_nothing()
    {
        var day = Office("2026-09-09", "2026-09-09");
        var plan = Against([day], "2026-09-07", "2026-09-11");

        Assert.Equal([day], plan.Removed);
        Assert.Empty(plan.Trimmed);
        Assert.Empty(plan.Split);
    }

    [Fact]
    public void An_overlap_at_the_start_shortens_the_old_record()
    {
        var week = Office("2026-09-07", "2026-09-11");
        Against([week], "2026-09-10", "2026-09-14");

        Assert.Equal(DateOnly.Parse("2026-09-07"), week.From);
        Assert.Equal(DateOnly.Parse("2026-09-09"), week.To);
    }

    [Fact]
    public void An_overlap_at_the_end_moves_the_old_record_forward()
    {
        var week = Office("2026-09-07", "2026-09-11");
        Against([week], "2026-09-04", "2026-09-08");

        Assert.Equal(DateOnly.Parse("2026-09-09"), week.From);
        Assert.Equal(DateOnly.Parse("2026-09-11"), week.To);
    }

    [Fact]
    public void A_record_that_does_not_overlap_is_left_alone()
    {
        var week = Office("2026-09-07", "2026-09-11");
        var plan = Against([week], "2026-09-14", "2026-09-18");

        Assert.Empty(plan.Removed);
        Assert.Empty(plan.Trimmed);
        Assert.Empty(plan.Split);
        Assert.Equal(DateOnly.Parse("2026-09-11"), week.To);
    }

    [Fact]
    public void Two_identical_halves_supersede_each_other()
    {
        var morning = Office("2026-09-09", "2026-09-09", DayPortion.Morning);
        var plan = Against([morning], "2026-09-09", "2026-09-09", DayPortion.Morning);

        Assert.Equal([morning], plan.Removed);
    }

    [Fact]
    public void A_morning_and_an_afternoon_leave_each_other_alone()
    {
        var morning = Office("2026-09-09", "2026-09-09", DayPortion.Morning);
        var plan = Against([morning], "2026-09-09", "2026-09-09", DayPortion.Afternoon);

        Assert.Empty(plan.Removed);
        Assert.Empty(plan.Trimmed);
    }

    [Fact]
    public void A_half_day_does_not_wipe_out_a_whole_one()
    {
        // Trimming the day away to make room for a morning would silently discard the
        // afternoon, which nobody asked to give up. Both survive and the cell shows both —
        // visibly odd, which is right for a case the model does not represent.
        var wholeDay = Office("2026-09-09", "2026-09-09");
        var plan = Against([wholeDay], "2026-09-09", "2026-09-09", DayPortion.Morning);

        Assert.Empty(plan.Removed);
        Assert.Empty(plan.Trimmed);
        Assert.Equal(DateOnly.Parse("2026-09-09"), wholeDay.From);
    }

    [Fact]
    public void A_whole_day_supersedes_a_half()
    {
        var morning = Office("2026-09-09", "2026-09-09", DayPortion.Morning);
        var plan = Against([morning], "2026-09-09", "2026-09-09");

        Assert.Equal([morning], plan.Removed);
    }
}
