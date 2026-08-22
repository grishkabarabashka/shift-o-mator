namespace ShiftOMator.Api.Contracts.Admin;

public record ShiftRequest(
    string UnitId, string Code, string Label, string? Description, string Color, string? Hotkey,
    string TimeZone, TimeOnly Start, TimeOnly End, bool CrossesMidnight, int BreakMinutes,
    bool CountsAsCoverage, bool EditableTime);
