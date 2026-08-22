namespace ShiftOMator.Api.Contracts.Admin;

public record HolidayRequest(DateOnly Date, string Name, List<string> LocationIds, bool IsFullDay);
