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
    IEnumerable<AbsenceCapacityRule> AbsenceCapacityRules,
    /// <summary>Kinds of non-working day, as data (ADR-0049). Active ones only — a
    /// retired type still appears on historical absences but must not be offered.</summary>
    IReadOnlyList<EventType> EventTypes,

    /// <summary>How each kind of presence is offered and drawn (ADR-0043). <b>All</b> of
    /// them, retired ones included: a record written before a kind was retired still has
    /// to render, and the menu is what filters on <c>IsActive</c>.</summary>
    IReadOnlyList<PresenceType> PresenceTypes);
