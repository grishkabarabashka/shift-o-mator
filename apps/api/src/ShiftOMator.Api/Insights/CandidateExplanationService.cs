using Microsoft.Extensions.AI;
using ShiftOMator.Application;

namespace ShiftOMator.Api.Insights;

/// <summary>
/// Phrases "why this person" over a <see cref="CandidateDigest"/> (ADR-0048).
///
/// The same contract as <see cref="GapSummaryService"/>: the deciding factor is computed
/// — <see cref="CandidateDigest.DecidingFactor"/> reads it straight off the ranker's
/// documented ordering — and this only turns it into a sentence a planner can act on.
/// Asking a model to work out *why* a ranking came out that way would get a plausible
/// rationale that is not the actual one, which is worse than none: the planner is about
/// to justify a rota decision with it.
///
/// The digest is useful without the model, so the endpoint returns it either way and
/// only the prose is conditional.
/// </summary>
public sealed class CandidateExplanationService(ChatModel model)
{
    public bool Configured => model.Configured;

    public string? ModelId => model.ModelId;

    private const string SystemPrompt = """
        You explain one shift-assignment suggestion to the planner who is about to accept
        or reject it. You are given a pre-computed digest of the ranking.

        How the ranking works, so you describe it correctly:
        - Only people eligible for the shift and available that day are candidates.
        - Among those, fewer times held in the last 90 days ranks higher; ties break on
          who held it longest ago; then on fewer soft-rule warnings.
        - A warning demotes a candidate but never excludes them.
        - "Not available" is a hard fact (leave, comp day, blackout, weekday), not a
          preference.

        Rules:
        - Two or three sentences. No bullets, no headings, no preamble.
        - Say who is suggested and the one reason that decided it — the digest names it.
        - If anyone was excluded for a reason worth knowing, say so in one clause.
        - Use only facts in the digest. Never invent a number, a name, a date or a cause.
        - If the digest says the order is arbitrary, say that plainly rather than
          manufacturing a reason.
        - Plain English.
        """;

    public async Task<string> ExplainAsync(string digest, CancellationToken ct)
    {
        if (model.Client is null) throw new InvalidOperationException("No chat model is configured.");

        var response = await model.Client.GetResponseAsync(
            [
                new ChatMessage(ChatRole.System, SystemPrompt),
                new ChatMessage(ChatRole.User, digest),
            ],
            new ChatOptions { MaxOutputTokens = 500 },
            ct);

        var text = response.Text;
        return string.IsNullOrWhiteSpace(text) ? "No explanation was produced." : text.Trim();
    }
}
