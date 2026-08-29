using ShiftOMator.Application;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Writing a feed a calendar client will subscribe to. The properties here are the ones
/// that go wrong silently: a subscriber does not report a malformed feed, it just shows
/// the wrong thing or nothing.
/// </summary>
public class IcsWriterTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

    private static string[] Lines(string ics) => ics.Split("\r\n");

    [Fact]
    public void Writes_an_all_day_entry_with_an_exclusive_end()
    {
        // The same trap as reading one, from the other side: a one-day entry on the 1st
        // ends on the 2nd, and getting it wrong turns a day off into two.
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", "Comp day", null, new DateOnly(2026, 9, 14), null, null, Busy: true),
        ], Now);

        Assert.Contains("DTSTART;VALUE=DATE:20260914", Lines(ics));
        Assert.Contains("DTEND;VALUE=DATE:20260915", Lines(ics));
    }

    [Fact]
    public void Writes_a_shift_as_a_timed_event_in_UTC()
    {
        var start = new DateTimeOffset(2026, 9, 14, 14, 0, 0, TimeSpan.Zero);
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", "Crew", null, new DateOnly(2026, 9, 14), start, start.AddHours(9), Busy: true),
        ], Now);

        Assert.Contains("DTSTART:20260914T140000Z", Lines(ics));
        Assert.Contains("DTEND:20260914T230000Z", Lines(ics));
        Assert.Contains("TRANSP:OPAQUE", Lines(ics));
    }

    [Fact]
    public void Marks_a_half_day_as_free_rather_than_busy()
    {
        // Busy time is a claim on the subscriber's day. Half of one is not.
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", "Leave (morning)", null, new DateOnly(2026, 9, 14), null, null, Busy: false),
        ], Now);

        Assert.Contains("TRANSP:TRANSPARENT", Lines(ics));
    }

    [Fact]
    public void Escapes_text()
    {
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", "Crew, late", "One; two\nthree", new DateOnly(2026, 9, 14), null, null, true),
        ], Now);

        Assert.Contains(@"SUMMARY:Crew\, late", Lines(ics));
        Assert.Contains(Lines(ics), line => line.Contains(@"One\; two\nthree", StringComparison.Ordinal));
    }

    [Fact]
    public void Folds_long_lines_at_the_octet_limit()
    {
        // A reader that meets a line over 75 octets is entitled to reject the whole file,
        // and a description is easily longer than that.
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", new string('x', 300), null, new DateOnly(2026, 9, 14), null, null, true),
        ], Now);

        Assert.All(Lines(ics), line =>
            Assert.True(System.Text.Encoding.UTF8.GetByteCount(line) <= 75, $"line too long: {line.Length}"));

        // And it has to unfold back into what went in, or the round trip through
        // IcsCalendar is a different string.
        Assert.Contains(new string('x', 300), Unfold(ics));
    }

    [Fact]
    public void Folds_without_splitting_a_character()
    {
        // A fold through the middle of a multi-byte character produces a line nothing can
        // decode. Two-octet characters land the boundary somewhere awkward on purpose.
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", string.Concat(Enumerable.Repeat("é", 200)), null,
                new DateOnly(2026, 9, 14), null, null, true),
        ], Now);

        Assert.All(Lines(ics), line =>
            Assert.True(System.Text.Encoding.UTF8.GetByteCount(line) <= 75, "line too long"));
        Assert.Contains(string.Concat(Enumerable.Repeat("é", 200)), Unfold(ics));
    }

    [Fact]
    public void Round_trips_through_the_reader()
    {
        // The two halves have to agree: this is what a subscriber does with the file.
        var ics = IcsWriter.Write("Test", [
            new CalendarEntry("uid-1", "Annual leave", null, new DateOnly(2026, 12, 24), null, null, true),
        ], Now);

        var day = Assert.Single(IcsCalendar.Parse(ics));
        Assert.Equal(new DateOnly(2026, 12, 24), day.Date);
        Assert.Equal("Annual leave", day.Name);
    }

    private static string Unfold(string ics) => ics.Replace("\r\n ", string.Empty, StringComparison.Ordinal);
}
