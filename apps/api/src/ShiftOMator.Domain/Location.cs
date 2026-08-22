namespace ShiftOMator.Domain;

/// <summary>Calendar and display timezone only — nothing to do with shift timing
/// (ADR-0002, narrowed). Many-to-many with PlanningUnit: Pune hosts AMER, EMEA and APAC
/// people at once.</summary>
public class Location
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Country { get; set; }
    public required string TimeZone { get; set; }
    public required string HolidayCalendarKey { get; set; }
    public List<IsoWeekday> WeekendDays { get; set; } = [];
}
