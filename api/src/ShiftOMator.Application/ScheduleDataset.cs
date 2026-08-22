using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>Everything an engine might need in one bag — mirrors domain/types.ts's
/// ScheduleDataset (ReferenceData + PlanData + history).</summary>
public class ScheduleDataset
{
    public List<Location> Locations { get; init; } = [];
    public List<Holiday> Holidays { get; init; } = [];
    public List<Region> Regions { get; init; } = [];
    public List<PlanningUnit> Units { get; init; } = [];
    public List<ShiftDefinition> Shifts { get; init; } = [];
    public List<ShiftRole> Roles { get; init; } = [];
    public List<DayConfiguration> DayConfigurations { get; init; } = [];
    public List<Person> People { get; init; } = [];
    public List<AbsenceCapacityRule> AbsenceCapacityRules { get; init; } = [];

    public List<Assignment> Assignments { get; init; } = [];
    public List<Absence> Absences { get; init; } = [];
    public List<CompDayEntry> CompDays { get; init; } = [];
    public List<Acknowledgement> Acknowledgements { get; init; } = [];
    public List<AssignmentHistoryEntry> History { get; init; } = [];
}
