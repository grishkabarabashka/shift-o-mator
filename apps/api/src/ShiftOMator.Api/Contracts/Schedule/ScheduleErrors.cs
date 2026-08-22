namespace ShiftOMator.Api.Contracts.Schedule;

public record InvalidRangeResponse(string Code, string Message);

public record DraftNotFoundResponse(string Code, string DraftId);
