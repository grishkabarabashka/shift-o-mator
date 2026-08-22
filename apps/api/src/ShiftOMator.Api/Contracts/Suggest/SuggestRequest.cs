namespace ShiftOMator.Api.Contracts.Suggest;

public record SuggestRequest(string ShiftId, DateOnly Date, string UnitId, HashSet<string>? ExcludePersonIds);
