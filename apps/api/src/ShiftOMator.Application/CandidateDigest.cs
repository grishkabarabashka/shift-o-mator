using System.Text;
using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Turns a <see cref="CandidateRanker"/> result into a compact, deterministic text
/// digest — the input a "why this person" explanation is written from (ADR-0048).
///
/// The same split as <see cref="IssueDigest"/>, for the same reason: the ranking is
/// already a decision the engine made on stated criteria, and those criteria are the
/// answer. A model asked to explain a ranking from raw data would invent a rationale;
/// asked to phrase a digest that already names the deciding factor, it cannot.
///
/// Nothing here calls a model, and nothing here is optional — the digest is worth
/// rendering on its own when no model is configured.
/// </summary>
public static class CandidateDigest
{
    /// <summary>Beyond this, candidates are counted rather than listed: nobody chooses
    /// from position eleven.</summary>
    private const int MaxCandidatesListed = 5;

    /// <summary>
    /// Why the top candidate is on top, in the ranker's own terms.
    ///
    /// The ordering is: eligibility, then availability, then fewest in 90 days, then
    /// recency, then warnings, then id. So the first *differing* criterion between the
    /// leader and the runner-up is the honest reason — not whichever number looks
    /// largest.
    /// </summary>
    public static string DecidingFactor(
        CandidateRanker.Candidate leader, CandidateRanker.Candidate? runnerUp)
    {
        if (runnerUp is null) return "the only person both eligible and available";

        if (leader.ShiftCountLast90 != runnerUp.ShiftCountLast90)
        {
            return $"has held this shift {leader.ShiftCountLast90} times in 90 days "
                + $"against {runnerUp.ShiftCountLast90} for the next candidate";
        }

        if (leader.DaysSinceLastHeld != runnerUp.DaysSinceLastHeld)
        {
            return leader.DaysSinceLastHeld is null
                ? "has never held this shift"
                : $"last held it {leader.DaysSinceLastHeld} days ago, longer than anyone else tied on count";
        }

        if (leader.Warnings.Count != runnerUp.Warnings.Count)
            return "carries fewer soft-rule warnings than the others on the same count";

        // Everything the ranker measures is equal; the tie-break is the id, and saying
        // so is more useful than implying a reason that does not exist.
        return "tied with the others on every fairness measure — the order here is arbitrary";
    }

    public static string Render(CandidateRanker.CandidateResult result, string shiftCode, DateOnly date)
    {
        var text = new StringBuilder();
        text.AppendLine($"Shift {shiftCode} on {date:yyyy-MM-dd} (weekday {date.DayOfWeek}).");
        text.AppendLine($"Team weekend average: {result.TeamWeekendAverage:0.0}.");
        text.AppendLine();

        if (result.Available.Count == 0)
        {
            text.AppendLine("No candidate is both eligible and available.");
        }
        else
        {
            var leader = result.Available[0];
            var runnerUp = result.Available.Count > 1 ? result.Available[1] : null;
            text.AppendLine($"Ranked first: {leader.Name} — {DecidingFactor(leader, runnerUp)}.");
            text.AppendLine();
            text.AppendLine("Ranked candidates (best first):");

            foreach (var candidate in result.Available.Take(MaxCandidatesListed))
            {
                var recency = candidate.DaysSinceLastHeld is null
                    ? "never held"
                    : $"last held {candidate.DaysSinceLastHeld}d ago";
                var warnings = candidate.Warnings.Count == 0
                    ? "no warnings"
                    : string.Join("; ", candidate.Warnings);
                text.AppendLine(
                    $"- {candidate.Name}: {candidate.ShiftCountLast90} in 90d, {recency}, "
                    + $"weekend load {candidate.WeekendLoad}, {warnings}");
            }

            var hidden = result.Available.Count - MaxCandidatesListed;
            if (hidden > 0) text.AppendLine($"- ({hidden} more eligible and available)");
        }

        if (result.Excluded.Count > 0)
        {
            text.AppendLine();
            text.AppendLine("Not available:");
            // Grouped by reason: "four on leave" is the finding; four names with the same
            // reason beside each is the same finding, spelled out four times.
            foreach (var group in result.Excluded.GroupBy(e => e.Reason).OrderByDescending(g => g.Count()))
            {
                var names = string.Join(", ", group.Select(e => e.Name).Order());
                text.AppendLine($"- {group.Key}: {names}");
            }
        }

        return text.ToString().TrimEnd();
    }
}
