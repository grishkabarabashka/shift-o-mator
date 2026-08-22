namespace ShiftOMator.Api.Contracts.Drafts;

public record OpenDraftRequest(string EditorPersonId, string UnitId, DateOnly RangeFrom, DateOnly RangeTo);
