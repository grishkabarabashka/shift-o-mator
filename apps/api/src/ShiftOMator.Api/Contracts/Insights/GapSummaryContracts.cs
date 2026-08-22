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
