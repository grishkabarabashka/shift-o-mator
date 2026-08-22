using System.Text;
using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Turns a validation run into a compact, deterministic text digest — the input an
/// explanation is written from.
///
/// Deliberately a pure function in Application, not part of whatever produces the prose.
/// The counting, grouping and ordering are the part that must be exactly right, and they
/// are testable on their own; the summary layer above only phrases what this states. If
/// the digest is wrong, the summary is wrong no matter how it is generated.
///
/// Grouped by (shift, level, code) rather than listed per date, because "Lead-E is
/// uncovered on four of five Fridays" is the finding, and forty dated lines are not.
/// </summary>
public static class IssueDigest
{
    /// <summary>Beyond this, dates are counted rather than listed: a reader (or a model)
    /// gets nothing from the 30th date that the count doesn't already say.</summary>
    private const int MaxDatesListed = 8;

    public record Line(
        IssueLevel Level, IssueCategory Category, IssueCode Code, string Subject,
        int Count, IReadOnlyList<DateOnly> Dates, string Example);

    /// <summary>
    /// <paramref name="Total"/> is the issue count, not a sum of the other figures:
    /// level and category are orthogonal (a blocking conflict is counted under both
    /// <paramref name="Blocking"/> and <paramref name="Conflicts"/>), so adding them up
    /// would report every issue twice.
    /// </summary>
    public record Digest(
        string UnitId, DateOnly From, DateOnly To,
        int Total, int Gaps, int Conflicts, int Warnings, int Blocking, int Acknowledged,
        IReadOnlyList<Line> Lines);

    /// <summary>Worst first. The enum declares Blocking before Warning, so its ordinal
    /// runs the wrong way for sorting — rank explicitly rather than relying on it.</summary>
    private static int Severity(IssueLevel level) => level switch
    {
        IssueLevel.Blocking => 2,
        IssueLevel.Warning => 1,
        _ => 0,
    };

    public static Digest Build(
        string unitId, DateOnly from, DateOnly to,
        IReadOnlyList<Issue> issues, IReadOnlySet<string> acknowledgedKeys, DatasetIndex index)
    {
        var lines = issues
            .GroupBy(i => (i.Level, i.Category, i.Code, Subject: SubjectOf(i, index)))
            .Select(g => new Line(
                g.Key.Level, g.Key.Category, g.Key.Code, g.Key.Subject,
                g.Count(),
                [.. g.Where(i => i.Date is not null).Select(i => i.Date!.Value).Distinct().OrderBy(d => d)],
                g.First().Message))
            // NOTE: worst and most frequent first — that's the order people look at them in.
            .OrderByDescending(l => Severity(l.Level))
            .ThenByDescending(l => l.Count)
            .ThenBy(l => l.Subject, StringComparer.Ordinal)
            .ToList();

        return new Digest(
            unitId, from, to,
            Total: issues.Count,
            Gaps: issues.Count(i => i.Category == IssueCategory.Gap),
            Conflicts: issues.Count(i => i.Category == IssueCategory.Conflict),
            Warnings: issues.Count(i => i.Level == IssueLevel.Warning),
            Blocking: issues.Count(i => i.Level == IssueLevel.Blocking),
            Acknowledged: issues.Count(i => acknowledgedKeys.Contains(i.Key)),
            lines);
    }

    /// <summary>Plain-text rendering — what actually gets sent for summarizing.</summary>
    public static string Render(Digest digest)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Unit: {digest.UnitId}");
        sb.AppendLine($"Period: {digest.From:yyyy-MM-dd} to {digest.To:yyyy-MM-dd}");
        sb.AppendLine($"Totals: {digest.Gaps} coverage gaps, {digest.Conflicts} conflicts, "
                      + $"{digest.Warnings} warnings, {digest.Blocking} blocking, {digest.Acknowledged} already acknowledged");
        sb.AppendLine();

        if (digest.Lines.Count == 0)
        {
            sb.AppendLine("No issues found in this period.");
            return sb.ToString();
        }

        sb.AppendLine("Findings (grouped):");
        foreach (var line in digest.Lines)
        {
            var dates = line.Dates.Count == 0
                ? "no specific dates"
                : line.Dates.Count <= MaxDatesListed
                    ? string.Join(", ", line.Dates.Select(d => d.ToString("yyyy-MM-dd (ddd)")))
                    : $"{line.Dates.Count} dates from {line.Dates[0]:yyyy-MM-dd} to {line.Dates[^1]:yyyy-MM-dd}";

            sb.AppendLine($"- [{line.Level}/{line.Category}/{line.Code}] {line.Subject} — {line.Count}x on {dates}");
            sb.AppendLine($"    example: {line.Example}");
        }
        return sb.ToString();
    }

    /// <summary>Who or what the issue is about, in the reader's vocabulary: a shift code
    /// or a person's name, not an id.</summary>
    private static string SubjectOf(Issue issue, DatasetIndex index)
    {
        if (issue.ShiftId is not null)
        {
            return index.Shifts.TryGetValue(issue.ShiftId, out var shift) ? shift.Code : issue.ShiftId;
        }
        if (issue.PersonId is not null)
        {
            return index.People.TryGetValue(issue.PersonId, out var person) ? person.DisplayName : issue.PersonId;
        }
        return issue.UnitId;
    }
}
