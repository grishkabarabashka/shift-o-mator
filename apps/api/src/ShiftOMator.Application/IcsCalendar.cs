using System.Globalization;

namespace ShiftOMator.Application;

/// <summary>
/// One all-day entry from a calendar feed.
///
/// <paramref name="Category"/> is the feed's own DESCRIPTION, first line only. It matters
/// more than it looks: a published national calendar carries observances as well as public
/// holidays — roughly two thirds of the entries in the ones we use — and importing
/// Valentine's Day as a non-working day is not a small mistake.
/// </summary>
public readonly record struct CalendarDay(DateOnly Date, string Name, string Category);

/// <summary>
/// Just enough iCalendar (RFC 5545) to read a published holiday calendar.
///
/// WHY a hand-rolled reader rather than a library: what a public holiday feed contains is
/// a list of all-day VEVENTs with a SUMMARY and a DTSTART, and that is all this needs.
/// Recurrence, timezones, alarms, attendees and the rest of RFC 5545 are not merely
/// unused — reading them would invite the import to produce something other than "these
/// dates are holidays", which is the only shape the domain has.
///
/// Deliberately tolerant: an entry it cannot make sense of is skipped, not fatal. A feed
/// with one malformed event should still import the other forty.
/// </summary>
public static class IcsCalendar
{
    /// <summary>
    /// All-day entries in the feed, one per date, in date order.
    ///
    /// A multi-day entry is expanded into its days. DTEND in an all-day event is
    /// <b>exclusive</b> per the spec — a one-day holiday on the 1st ends on the 2nd — and
    /// treating it as inclusive is the classic way to import an extra day off.
    ///
    /// Two entries on one date are both returned. Choosing between them needs to know
    /// which of them is a public holiday, and that is a decision about *importing*, not
    /// about reading a file.
    /// </summary>
    public static IReadOnlyList<CalendarDay> Parse(string ics)
    {
        var days = new List<CalendarDay>();

        string? summary = null;
        string? description = null;
        DateOnly? start = null;
        DateOnly? endExclusive = null;
        var inEvent = false;

        foreach (var line in Unfold(ics))
        {
            if (line.Equals("BEGIN:VEVENT", StringComparison.OrdinalIgnoreCase))
            {
                inEvent = true;
                summary = null;
                description = null;
                start = null;
                endExclusive = null;
                continue;
            }

            if (line.Equals("END:VEVENT", StringComparison.OrdinalIgnoreCase))
            {
                inEvent = false;
                if (start is null || string.IsNullOrWhiteSpace(summary)) continue;

                var last = endExclusive is { } e && e > start.Value ? e.AddDays(-1) : start.Value;
                // A guard, not a rule: a feed with a nonsense DTEND must not expand into
                // thousands of rows on its way to the database.
                if (last.DayNumber - start.Value.DayNumber > 366) last = start.Value;

                for (var date = start.Value; date <= last; date = date.AddDays(1))
                {
                    days.Add(new CalendarDay(date, summary!, FirstLine(description)));
                }
                continue;
            }

            if (!inEvent) continue;

            var (name, value) = SplitProperty(line);
            switch (name)
            {
                case "SUMMARY":
                    summary = Unescape(value);
                    break;
                case "DESCRIPTION":
                    description = Unescape(value);
                    break;
                case "DTSTART":
                    start = ReadDate(value);
                    break;
                case "DTEND":
                    endExclusive = ReadDate(value);
                    break;
            }
        }

        days.Sort((a, b) => a.Date.CompareTo(b.Date));
        return days;
    }

    /// <summary>
    /// Joins continuation lines. A folded line is one whose successor begins with a space
    /// or a tab — the feed's own line breaks are not the content's, and a long holiday
    /// name is wrapped by every generator that emits one.
    /// </summary>
    private static IEnumerable<string> Unfold(string ics)
    {
        var current = new System.Text.StringBuilder();
        foreach (var raw in ics.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length > 0 && (line[0] == ' ' || line[0] == '\t'))
            {
                current.Append(line[1..]);
                continue;
            }

            if (current.Length > 0) yield return current.ToString();
            current.Clear();
            current.Append(line);
        }
        if (current.Length > 0) yield return current.ToString();
    }

    /// <summary>Property name and value. The name may carry parameters
    /// (<c>DTSTART;VALUE=DATE</c>, <c>SUMMARY;LANGUAGE=en</c>) which are not needed:
    /// the value's own shape says whether it is a date or a timestamp.</summary>
    private static (string Name, string Value) SplitProperty(string line)
    {
        var colon = line.IndexOf(':');
        if (colon < 0) return (string.Empty, string.Empty);

        var head = line[..colon];
        var semicolon = head.IndexOf(';');
        var name = (semicolon < 0 ? head : head[..semicolon]).ToUpperInvariant();
        return (name, line[(colon + 1)..]);
    }

    /// <summary>
    /// <c>20260101</c> or <c>20260101T000000Z</c>. The time is dropped rather than
    /// converted: a holiday is a date in a place, and the feed's UTC offset would move it
    /// across midnight for half the world.
    /// </summary>
    private static DateOnly? ReadDate(string value)
    {
        var text = value.Trim();
        var t = text.IndexOf('T');
        if (t > 0) text = text[..t];

        return DateOnly.TryParseExact(text, "yyyyMMdd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var date)
            ? date
            : null;
    }

    /// <summary>
    /// The first line of the description, unescaped.
    ///
    /// WHY it splits before unescaping: a published national calendar writes
    /// <c>Observance\\nTo hide observances, go to Google Calendar Settings &gt; Holidays
    /// in United Kingdom</c>. Unescape first and the line break is gone, leaving one run
    /// of text that contains the word "Holidays" — so an observance would test as a
    /// holiday. The classification lives on the first line and nowhere else.
    /// </summary>
    private static string FirstLine(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var newline = value.IndexOf("\\n", StringComparison.OrdinalIgnoreCase);
        return Unescape(newline >= 0 ? value[..newline] : value);
    }

    /// <summary>
    /// Whether this entry describes a day off rather than a note in the calendar.
    ///
    /// This is the difference between importing a twelve public holidays and importing
    /// forty of them with Valentine Day among them: in the feeds we use, two entries in
    /// three are observances.
    ///
    /// An empty category means the feed does not classify at all — a file an HR team
    /// exported, say — and those are taken at face value, because the alternative is
    /// dropping everything in it.
    /// </summary>
    public static bool IsHoliday(string category) =>
        category.Length == 0
        || category.Contains("holiday", StringComparison.OrdinalIgnoreCase);

    /// <summary>Escaped text per RFC 5545: a comma, a semicolon, a newline or a
    /// backslash in a SUMMARY arrives with a backslash in front of it.</summary>
    private static string Unescape(string value) =>
        value.Replace("\\n", " ", StringComparison.OrdinalIgnoreCase)
            .Replace("\\,", ",", StringComparison.Ordinal)
            .Replace("\\;", ";", StringComparison.Ordinal)
            .Replace("\\\\", "\\", StringComparison.Ordinal)
            .Trim();
}
