using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Reference;

/// <summary>Everything the client loads once and keeps around — units already carry
/// their own shifts/day-configurations/absence-capacity-rules, flattened here too
/// since every current consumer reads them as flat lists.</summary>
public record ReferenceResponse(
    IReadOnlyList<Location> Locations,
    IReadOnlyList<Holiday> Holidays,
    IReadOnlyList<PlanningUnit> Units,
    IEnumerable<Shift> Shifts,
    IEnumerable<DayConfiguration> DayConfigurations,
    IReadOnlyList<Person> People,
    IEnumerable<AbsenceCapacityRule> AbsenceCapacityRules);
