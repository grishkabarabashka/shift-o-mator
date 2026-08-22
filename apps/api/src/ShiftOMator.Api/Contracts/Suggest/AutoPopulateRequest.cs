namespace ShiftOMator.Api.Contracts.Suggest;

/// <summary>
/// <paramref name="DraftId"/> is the draft the planner has open, if any. Generation runs
/// against published data *plus* that draft — without it, a cell the planner filled by
/// hand five minutes ago looks empty to the generator, and accepting the preview
/// overwrites the decision they just made.
/// </summary>
public record AutoPopulateRequest(
    string UnitId, DateOnly RangeFrom, DateOnly RangeTo,
    HashSet<string>? LockedAssignmentIds, string ActorId, string? DraftId = null);
