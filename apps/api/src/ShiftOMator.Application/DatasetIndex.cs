using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Lookups over a <see cref="ScheduleDataset"/> — mirrors domain/lookup.ts#DatasetIndex.
/// Engines take this as a parameter rather than rebuilding maps on every call.
/// </summary>
public class DatasetIndex
{
    public required IReadOnlyDictionary<string, Location> Locations { get; init; }
    public required IReadOnlyDictionary<string, PlanningUnit> Units { get; init; }
    public required IReadOnlyDictionary<string, Shift> Shifts { get; init; }
    public required IReadOnlyDictionary<string, Person> People { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<Shift>> ShiftsByUnit { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<Person>> PeopleByUnit { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<DayConfiguration>> DayConfigsByUnit { get; init; }
    /// <summary>Holiday dates by location id.</summary>
    public required IReadOnlyDictionary<string, IReadOnlySet<DateOnly>> HolidaysByLocation { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<Absence>> AbsencesByPerson { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<CompDayEntry>> CompDaysByPerson { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<Assignment>> AssignmentsByPerson { get; init; }
    /// <summary>Keyed by CellKey(personId, date).</summary>
    public required IReadOnlyDictionary<string, Assignment> AssignmentsByCell { get; init; }

    public static string CellKey(string personId, DateOnly date) => $"{personId}|{date:yyyy-MM-dd}";

    public static DatasetIndex Build(ScheduleDataset data)
    {
        var holidaysByLocation = data.Locations.ToDictionary(
            l => l.Id,
            l => (IReadOnlySet<DateOnly>)data.Holidays
                .Where(h => h.LocationIds.Contains(l.Id))
                .Select(h => h.Date)
                .ToHashSet());

        var assignmentsByCell = new Dictionary<string, Assignment>();
        foreach (var a in data.Assignments) assignmentsByCell[CellKey(a.PersonId, a.Date)] = a;

        return new DatasetIndex
        {
            Locations = data.Locations.ToDictionary(x => x.Id),
            Units = data.Units.ToDictionary(x => x.Id),
            Shifts = data.Shifts.ToDictionary(x => x.Id),
            People = data.People.ToDictionary(x => x.Id),
            ShiftsByUnit = GroupBy(data.Shifts, s => s.UnitId),
            PeopleByUnit = GroupBy(data.People, p => p.UnitId),
            DayConfigsByUnit = GroupBy(data.DayConfigurations, c => c.UnitId),
            HolidaysByLocation = holidaysByLocation,
            AbsencesByPerson = GroupBy(data.Absences, a => a.PersonId),
            CompDaysByPerson = GroupBy(data.CompDays, c => c.PersonId),
            AssignmentsByPerson = GroupBy(data.Assignments, a => a.PersonId),
            AssignmentsByCell = assignmentsByCell,
        };
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<T>> GroupBy<T>(
        IEnumerable<T> items, Func<T, string> key) =>
        items.GroupBy(key).ToDictionary(g => g.Key, g => (IReadOnlyList<T>)g.ToList());
}
