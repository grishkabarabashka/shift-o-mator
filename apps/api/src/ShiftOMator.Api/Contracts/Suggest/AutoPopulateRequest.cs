namespace ShiftOMator.Api.Contracts.Suggest;

/// <summary>
/// <paramref name="DraftId"/> is the draft the planner has open, if any. Generation runs
/// against published data *plus* that draft — without it, a cell the planner filled by
/// hand five minutes ago looks empty to the generator, and accepting the preview
/// overwrites the decision they just made.
///
/// The actor is the authenticated caller, not a payload field (ADR-0039).
/// </summary>
public record AutoPopulateRequest(
    string UnitId, DateOnly RangeFrom, DateOnly RangeTo,
    HashSet<string>? LockedAssignmentIds, string? DraftId = null);
