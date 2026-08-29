using System.Globalization;
using System.Text;

namespace ShiftOMator.Application;

/// <summary>One entry in a published feed. Either a timed window or a whole day.</summary>
public readonly record struct CalendarEntry(
    string Uid,
    string Summary,
    string? Description,
    DateOnly Date,
    /// <summary>Null for an all-day entry — leave, a comp day, a holiday.</summary>
    DateTimeOffset? Start,
    DateTimeOffset? End,
    /// <summary>Whether the entry blocks time in the subscriber's own calendar. A shift
    /// does; "remote on Tuesday" is a note about a day, not a meeting.</summary>
    bool Busy);

/// <summary>
/// Writes an iCalendar feed — the other half of <see cref="IcsCalendar"/>.
///
/// WHY hand-rolled, again: what a subscription needs is VEVENTs with a UID, a summary and
/// either a timestamp pair or a date. Recurrence would be wrong here even if it were
/// available — a rota is not a rule, it is a list of decisions, and expressing it as RRULE
/// would make every exception a correction the subscriber's client has to apply.
///
/// <b>Every entry carries a stable UID.</b> That is what makes a subscription an update
/// rather than a pile of duplicates: a shift that moves has to arrive under the same UID it
/// had before, or the reader keeps the old one forever.
/// </summary>
public static class IcsWriter
{
    /// <summary>The line length RFC 5545 requires folding at, in octets.</summary>
    private const int MaxLine = 75;

    public static string Write(string calendarName, IEnumerable<CalendarEntry> entries, DateTimeOffset now)
    {
        var sb = new StringBuilder();
        Line(sb, "BEGIN:VCALENDAR");
        Line(sb, "VERSION:2.0");
        Line(sb, "PRODID:-//shift-o-mator//EN");
        Line(sb, "CALSCALE:GREGORIAN");
        Line(sb, "METHOD:PUBLISH");
        Line(sb, $"X-WR-CALNAME:{Escape(calendarName)}");
        // Half an hour is the shortest refresh most readers will honour, and a rota does
        // not change faster than a planner can publish one.
        Line(sb, "REFRESH-INTERVAL;VALUE=DURATION:PT30M");
        Line(sb, "X-PUBLISHED-TTL:PT30M");

        foreach (var entry in entries)
        {
            Line(sb, "BEGIN:VEVENT");
            Line(sb, $"UID:{entry.Uid}");
            Line(sb, $"DTSTAMP:{now.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}");

            if (entry.Start is { } start && entry.End is { } end)
            {
                Line(sb, $"DTSTART:{start.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}");
                Line(sb, $"DTEND:{end.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}");
            }
            else
            {
                // DTEND is exclusive for an all-day event: a one-day entry on the 1st ends
                // on the 2nd. Getting this wrong is how a day off becomes two.
                Line(sb, $"DTSTART;VALUE=DATE:{entry.Date:yyyyMMdd}");
                Line(sb, $"DTEND;VALUE=DATE:{entry.Date.AddDays(1):yyyyMMdd}");
            }

            Line(sb, $"SUMMARY:{Escape(entry.Summary)}");
            if (!string.IsNullOrWhiteSpace(entry.Description))
                Line(sb, $"DESCRIPTION:{Escape(entry.Description)}");
            Line(sb, entry.Busy ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT");
            Line(sb, "END:VEVENT");
        }

        Line(sb, "END:VCALENDAR");
        return sb.ToString();
    }

    /// <summary>
    /// Appends one content line, folded to <see cref="MaxLine"/> octets with a leading
    /// space on the continuations — which is what <see cref="IcsCalendar"/> unfolds on the
    /// way back in, and what readers expect of a long summary.
    /// </summary>
    private static void Line(StringBuilder sb, string content)
    {
        if (Encoding.UTF8.GetByteCount(content) <= MaxLine)
        {
            sb.Append(content).Append("\r\n");
            return;
        }

        // Measured in octets, because that is what the limit is in — and split on whole
        // characters, because a fold through the middle of a multi-byte one produces a line
        // no reader can decode. A continuation costs one octet for its leading space.
        var index = 0;
        var start = 0;
        var budget = MaxLine;

        while (index < content.Length)
        {
            var width = char.IsHighSurrogate(content[index]) ? 2 : 1;
            var size = Encoding.UTF8.GetByteCount(content.AsSpan(index, width));

            if (size > budget)
            {
                if (start > 0) sb.Append(' ');
                sb.Append(content, start, index - start).Append("\r\n");
                start = index;
                budget = MaxLine - 1;
            }

            budget -= size;
            index += width;
        }

        if (start > 0) sb.Append(' ');
        sb.Append(content, start, content.Length - start).Append("\r\n");
    }

    /// <summary>RFC 5545 text escaping. The backslash goes first, or it would escape the
    /// escapes added after it.</summary>
    private static string Escape(string value) =>
        value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace(";", "\\;", StringComparison.Ordinal)
            .Replace(",", "\\,", StringComparison.Ordinal)
            .Replace("\r\n", "\\n", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal);

    /// <summary>A UID that survives the entry being edited: same person, same day, same
    /// kind of thing. A calendar reader keyed on a changing id accumulates duplicates
    /// instead of updating.</summary>
    public static string Uid(string kind, string entityId) =>
        $"{kind}-{entityId}@shift-o-mator".ToLowerInvariant();

    /// <summary>Formats a date for a summary, in the reader's language-neutral form.</summary>
    public static string Day(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
