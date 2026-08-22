using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/dayConfig.ts. Two independent things resolve here and nowhere else:
///
/// 1. **Which day-config group applies** (ADR-0016). Specific-to-general order:
///    Date → Holiday → Weekend → the weekday group containing this weekday. Holiday-ness
///    is judged by the unit's *primary location's* calendar, not the person's — a
///    roster-level requirement, not a personal one (PlanningUnit.PrimaryLocationId,
///    replacing Region.PrimaryLocationId).
/// 2. **Which version is in effect** (ADR-0021). The version with the latest
///    EffectiveFrom not exceeding the date. A rule raised today doesn't repaint last
///    March.
/// </summary>
public static class DayConfigurationResolver
{
    private static readonly Dictionary<DayConfigKey, int> KeyPriority = new()
    {
        [DayConfigKey.Date] = 4,
        [DayConfigKey.Holiday] = 3,
        [DayConfigKey.Weekend] = 2,
        [DayConfigKey.Friday] = 1,
        [DayConfigKey.Weekday] = 0,
    };

    public static DayConfiguration? Resolve(string unitId, DateOnly date, DatasetIndex index)
    {
        if (!index.Units.TryGetValue(unitId, out var unit)) return null;
        if (!index.Locations.TryGetValue(unit.PrimaryLocationId, out var primaryLocation)) return null;

        var weekday = DateHelpers.IsoWeekdayOf(date);
        var isHoliday = DateHelpers.IsHolidayIn(date, primaryLocation, index);
        var isWeekend = DateHelpers.IsWeekendIn(date, primaryLocation);

        if (!index.DayConfigsByUnit.TryGetValue(unitId, out var configs)) return null;

        var candidates = configs
            .Where(c => c.EffectiveFrom <= date && IsApplicable(c, date, weekday, isHoliday, isWeekend))
            .ToList();
        if (candidates.Count == 0) return null;

        // NOTE: the most specific group wins; within it, the latest effective version wins.
        var best = candidates[0];
        foreach (var candidate in candidates.Skip(1))
        {
            var byPriority = KeyPriority[candidate.Key] - KeyPriority[best.Key];
            if (byPriority > 0) { best = candidate; continue; }
            if (byPriority == 0 && candidate.EffectiveFrom > best.EffectiveFrom) best = candidate;
        }
        return best;
    }

    public static ShiftRequirement? ResolveRequirement(string unitId, string shiftId, DateOnly date, DatasetIndex index) =>
        Resolve(unitId, date, index)?.ShiftRequirements.FirstOrDefault(r => r.ShiftId == shiftId);

    /// <summary>Shifts that can be placed this day at all: a requirement or IsDefault.
    /// The cell picker shows this set intersected with the person's eligibility.</summary>
    public static List<string> ShiftsAvailableOn(string unitId, DateOnly date, DatasetIndex index)
    {
        var config = Resolve(unitId, date, index);
        if (config is null) return [];
        return config.ShiftRequirements
            .Where(r => r.Min > 0 || r.IsDefault || r.Max != 0)
            .Select(r => r.ShiftId)
            .ToList();
    }

    /// <summary>Integrity check: the same weekday claimed by two weekday-family groups.</summary>
    public static List<string> FindWeekdayCollisions(IEnumerable<DayConfiguration> configs)
    {
        var problems = new List<string>();
        var byUnitAndVersion = new Dictionary<string, Dictionary<IsoWeekday, List<DayConfigKey>>>();

        foreach (var config in configs)
        {
            if (config.Key != DayConfigKey.Weekday && config.Key != DayConfigKey.Friday) continue;
            var bucketKey = $"{config.UnitId}|{config.EffectiveFrom:yyyy-MM-dd}";
            if (!byUnitAndVersion.TryGetValue(bucketKey, out var byWeekday))
            {
                byWeekday = [];
                byUnitAndVersion[bucketKey] = byWeekday;
            }
            foreach (var weekday in config.Weekdays)
            {
                if (!byWeekday.TryGetValue(weekday, out var keys)) byWeekday[weekday] = keys = [];
                keys.Add(config.Key);
            }
        }

        foreach (var (bucketKey, byWeekday) in byUnitAndVersion)
        {
            foreach (var (weekday, keys) in byWeekday)
            {
                if (keys.Count > 1)
                {
                    problems.Add($"{bucketKey}: weekday {(int)weekday} belongs to {string.Join(" and ", keys)}");
                }
            }
        }
        return problems;
    }

    private static bool IsApplicable(
        DayConfiguration config, DateOnly date, IsoWeekday weekday, bool isHoliday, bool isWeekend) =>
        config.Key switch
        {
            DayConfigKey.Date => config.Date == date,
            DayConfigKey.Holiday => isHoliday,
            DayConfigKey.Weekend => isWeekend && config.Weekdays.Contains(weekday),
            DayConfigKey.Friday or DayConfigKey.Weekday =>
                !isHoliday && !isWeekend && config.Weekdays.Contains(weekday),
            _ => false,
        };
}
