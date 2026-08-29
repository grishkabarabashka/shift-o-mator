namespace ShiftOMator.Api.Contracts.Insights;

/// <summary>Same (unit, period, optional draft) triple every other read takes — the
/// summary is about what the planner is looking at, not about published data.</summary>
public record GapSummaryRequest(string UnitId, DateOnly From, DateOnly To, string? DraftId = null);

/// <summary>
/// The counts travel with the prose deliberately: they come from the validator, the text
/// does not, and the UI shows both so a reader can check one against the other.
/// <paramref name="Model"/> is null when no model was called (a clean period answers
/// itself).
/// </summary>
public record GapSummaryResponse(
    string Summary, int Total, int Gaps, int Conflicts, int Warnings, int Blocking,
    string? Model, DateTimeOffset GeneratedAt);

/// <summary>
/// "Why this person for this cell" (ADR-0048). Takes the same shape a suggestion takes,
/// because it explains exactly that suggestion.
/// </summary>
public record CandidateExplanationRequest(
    string ShiftId, DateOnly Date, string UnitId, HashSet<string>? ExcludePersonIds = null);

/// <summary>
/// The digest travels with the prose, and is filled in even when no model is configured.
///
/// WHY: the deciding factor is computed, not generated — it is read straight off the
/// ranker's documented ordering. A planner who has no model available still gets the
/// real answer, just not phrased; and one who does can check the sentence against it.
/// </summary>
public record CandidateExplanationResponse(
    string? Explanation,
    string Digest,
    string? SuggestedPersonId,
    string? SuggestedPersonName,
    string DecidingFactor,
    int AvailableCount,
    int ExcludedCount,
    string? Model,
    DateTimeOffset GeneratedAt);
