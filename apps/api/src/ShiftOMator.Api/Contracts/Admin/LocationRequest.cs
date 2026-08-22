using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

public record LocationRequest(string Name, string Country, string TimeZone, string HolidayCalendarKey, List<IsoWeekday> WeekendDays);
