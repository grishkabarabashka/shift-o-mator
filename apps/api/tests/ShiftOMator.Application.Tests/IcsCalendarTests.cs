using ShiftOMator.Application;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Reading a published holiday calendar. The cases here are the ones real feeds actually
/// produce, not the ones RFC 5545 permits.
/// </summary>
public class IcsCalendarTests
{
    private static string Feed(params string[] lines) =>
        string.Join("\r\n", ["BEGIN:VCALENDAR", "VERSION:2.0", .. lines, "END:VCALENDAR"]);

    [Fact]
    public void Reads_an_all_day_entry()
    {
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260101",
            "DTEND;VALUE=DATE:20260102",
            "SUMMARY:New Year's Day",
            "END:VEVENT"));

        var day = Assert.Single(days);
        Assert.Equal(new DateOnly(2026, 1, 1), day.Date);
        Assert.Equal("New Year's Day", day.Name);
    }

    [Fact]
    public void Treats_DTEND_as_exclusive()
    {
        // The classic way to import an extra day off: a one-day holiday on the 1st is
        // written as ending on the 2nd, and reading that inclusively books both.
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20261225",
            "DTEND;VALUE=DATE:20261227",
            "SUMMARY:Christmas",
            "END:VEVENT"));

        Assert.Equal(
            [new DateOnly(2026, 12, 25), new DateOnly(2026, 12, 26)],
            days.Select(d => d.Date));
    }

    [Fact]
    public void Joins_a_folded_summary()
    {
        // Every generator wraps long lines, and a holiday name is the thing that gets
        // wrapped. Read naively, the name is truncated at the fold.
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260601",
            "SUMMARY:Queen",
            " s Birthday (observed)",
            "END:VEVENT"));

        Assert.Equal("Queens Birthday (observed)", Assert.Single(days).Name);
    }

    [Fact]
    public void Unescapes_text()
    {
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260704",
            @"SUMMARY:Independence Day\, observed",
            "END:VEVENT"));

        Assert.Equal("Independence Day, observed", Assert.Single(days).Name);
    }

    [Fact]
    public void Skips_what_it_cannot_read_rather_than_failing()
    {
        // A feed with one malformed event should still import the other forty.
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:notadate",
            "SUMMARY:Broken",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260501",
            "SUMMARY:May Day",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260502",
            "END:VEVENT"));

        Assert.Equal("May Day", Assert.Single(days).Name);
    }

    [Fact]
    public void Drops_the_time_from_a_timed_entry()
    {
        // A holiday is a date in a place. Converting the feed UTC offset would move it
        // across midnight for half the world.
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART:20260315T230000Z",
            "SUMMARY:Late entry",
            "END:VEVENT"));

        Assert.Equal(new DateOnly(2026, 3, 15), Assert.Single(days).Date);
    }

    [Fact]
    public void Returns_both_entries_on_one_date()
    {
        // Choosing between them needs to know which is a public holiday, and that is a
        // decision about importing rather than about reading a file.
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260101",
            "SUMMARY:First",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260101",
            "SUMMARY:Second",
            "END:VEVENT"));

        Assert.Equal(["First", "Second"], days.Select(d => d.Name));
    }

    /// <summary>
    /// The difference between importing a country twelve public holidays and importing
    /// forty of them with Valentine Day among them. Two entries in three are observances
    /// in the feeds this product offers.
    /// </summary>
    [Fact]
    public void Reads_the_category_from_the_first_line_of_the_description()
    {
        var days = IcsCalendar.Parse(Feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260214",
            "SUMMARY:Valentine's Day",
            @"DESCRIPTION:Observance
To hide observances, go to Settings > Holidays in United Kingdom",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20260403",
            "SUMMARY:Good Friday",
            "DESCRIPTION:Public holiday",
            "END:VEVENT"));

        var observance = days.First(d => d.Name.StartsWith("Valentine"));
        var holiday = days.First(d => d.Name == "Good Friday");

        // Unescaping before splitting would leave one run of text containing the word
        // "Holidays", and the observance would test as a holiday.
        Assert.Equal("Observance", observance.Category);
        Assert.False(IcsCalendar.IsHoliday(observance.Category));
        Assert.True(IcsCalendar.IsHoliday(holiday.Category));
    }

    [Fact]
    public void Takes_an_unclassified_feed_at_face_value()
    {
        // A file an HR team exported has no categories at all, and dropping everything in
        // it would be the wrong reading of "no evidence".
        Assert.True(IcsCalendar.IsHoliday(string.Empty));
    }
}
