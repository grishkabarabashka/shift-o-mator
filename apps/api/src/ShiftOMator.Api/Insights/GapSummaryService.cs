using Microsoft.Extensions.AI;
using ShiftOMator.Application;

namespace ShiftOMator.Api.Insights;

/// <summary>
/// Writes the prose over a <see cref="IssueDigest.Digest"/>: "Fridays are the problem —
/// Lead-E is uncovered on four of five, and the two people eligible for it are both on
/// leave the same week."
///
/// The split matters. Counting, grouping and ordering happen in
/// <see cref="IssueDigest"/> — pure, tested, and the same every run. This class only
/// phrases what the digest already states, and the prompt says so explicitly: no numbers
/// the digest does not contain, no advice the data does not support. A summary that
/// invents a fact is worse than no summary, because it is the part a manager quotes.
///
/// Which model answers is <see cref="ChatModel"/>'s business, not this class's — nothing
/// here names a provider.
/// </summary>
public sealed class GapSummaryService(ChatModel model)
{
    public bool Configured => model.Configured;

    public string? ModelId => model.ModelId;

    private const string SystemPrompt = """
        You brief the manager of a global application-support team on the state of a
        shift plan. You are given a pre-computed digest of validation findings for one
        planning unit over one period.

        Vocabulary, so you use the words the team uses:
        - A "gap" is a shift whose required minimum headcount is not met on a date.
        - A "conflict" is someone rostered on a day they are absent.
        - A "warning" is a soft rule bent (weekend load, shifts per week, a preference).
        - "Blocking" means the plan cannot be published as-is.
        - None of these stop a publish except blocking ones; the rest are decisions the
          planner still has to make.

        Write for someone deciding where to spend the next hour. Rules:
        - Lead with the pattern, not the count: which shifts, which weekdays, which
          people recur.
        - At most five bullets. No preamble, no closing summary, no headings.
        - Use only facts present in the digest. Never invent a number, a name, a date, or
          a cause. If the digest does not say why, do not guess why.
        - Where the digest supports it, say what to look at next in one clause.
        - If there is nothing meaningful to report, say so in one line.
        - Plain English, no markdown emphasis, no bullets other than "- ".
        """;

    public async Task<string> SummarizeAsync(IssueDigest.Digest digest, CancellationToken ct)
    {
        if (model.Client is null) throw new InvalidOperationException("No chat model is configured.");

        var response = await model.Client.GetResponseAsync(
            [
                new ChatMessage(ChatRole.System, SystemPrompt),
                new ChatMessage(ChatRole.User, IssueDigest.Render(digest)),
            ],
            // NOTE: brevity is built in by the prompt, which caps it at five bullets — the
            // limit here is insurance against sprawl, not a content restriction.
            new ChatOptions { MaxOutputTokens = 2000 },
            ct);

        var text = response.Text;
        return string.IsNullOrWhiteSpace(text) ? "No summary was produced." : text.Trim();
    }
}
