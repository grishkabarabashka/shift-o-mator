using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>Calendar helpers shared across engines — mirrors parts of engine/dates.ts.</summary>
public static class DateHelpers
{
    public static IsoWeekday IsoWeekdayOf(DateOnly date) =>
        (IsoWeekday)((int)date.DayOfWeek == 0 ? 7 : (int)date.DayOfWeek);

    public static bool IsWeekendIn(DateOnly date, Location location) =>
        location.WeekendDays.Contains(IsoWeekdayOf(date));

    public static bool IsHolidayIn(DateOnly date, Location location, DatasetIndex index) =>
        index.HolidaysByLocation.TryGetValue(location.Id, out var dates) && dates.Contains(date);

    public static bool IsNonWorkingDayIn(DateOnly date, Location location, DatasetIndex index) =>
        IsWeekendIn(date, location) || IsHolidayIn(date, location, index);

    public static IEnumerable<DateOnly> EachDate(DateOnly from, DateOnly to)
    {
        for (var cursor = from; cursor <= to; cursor = cursor.AddDays(1)) yield return cursor;
    }

    public static bool RangesOverlap(DateOnly aFrom, DateOnly aTo, DateOnly bFrom, DateOnly bTo) =>
        aFrom <= bTo && bFrom <= aTo;

    public static int DaysBetween(DateOnly from, DateOnly to) => to.DayNumber - from.DayNumber;

    /// <summary>Absolute [start, end) window for a role's duty on a date, in the role's own
    /// timezone (ADR-0001) — mirrors engine/dates.ts#shiftInterval. DST-aware via
    /// TimeZoneInfo, not a fixed UTC offset.</summary>
    public static UtcInterval ShiftInterval(ShiftRole role, DateOnly date, TimeOverride? overrideWindow = null)
    {
        var start = overrideWindow?.Start ?? role.Start;
        var end = overrideWindow?.End ?? role.End;
        var crossesMidnight = overrideWindow?.CrossesMidnight ?? role.CrossesMidnight;

        var tz = TimeZoneInfo.FindSystemTimeZoneById(role.TimeZone);
        var startLocal = date.ToDateTime(start);
        var endDate = crossesMidnight ? date.AddDays(1) : date;
        var endLocal = endDate.ToDateTime(end);

        var startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, tz);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, tz);
        if (endUtc <= startUtc)
        {
            throw new InvalidOperationException(
                $"Role window for {role.Code} on {date:yyyy-MM-dd} is empty or negative: {start}–{end}");
        }
        return new UtcInterval(startUtc, endUtc);
    }

    public static double RestHoursBetween(UtcInterval earlier, UtcInterval later) =>
        (later.Start - earlier.End).TotalHours;

    public static bool IntervalsOverlap(UtcInterval a, UtcInterval b) => a.Start < b.End && b.Start < a.End;

    public static int CountWorkdays(DateOnly from, DateOnly to, Location location, DatasetIndex index)
    {
        var count = 0;
        foreach (var date in EachDate(from, to))
        {
            if (!IsNonWorkingDayIn(date, location, index)) count++;
        }
        return count;
    }
}
