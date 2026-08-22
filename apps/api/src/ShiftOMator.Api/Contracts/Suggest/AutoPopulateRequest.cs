namespace ShiftOMator.Api.Contracts.Suggest;

public record AutoPopulateRequest(
    string UnitId, DateOnly RangeFrom, DateOnly RangeTo,
    HashSet<string>? LockedAssignmentIds, string ActorId);
