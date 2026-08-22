namespace ShiftOMator.Domain;

/// <summary>
/// The single rule axis (supersedes ADR-0004/0020's Region/PlanningUnit split — Region
/// duplicated PlanningUnit for 65 of 76 people; Service Transition was the only real
/// second axis, and it is now just another unit). Carries shifts, day configurations,
/// absence-capacity rules and comp-off policy — everything a Region used to own.
///
/// <see cref="PrimaryLocationId"/> is the location whose calendar decides holiday-ness
/// for this unit's day-configuration resolution (mirrors the old Region.PrimaryLocationId)
/// — a roster-level judgment, not a personal one. For unit-st, which has no single home
/// turf, this is an ASSUMPTION (New York, the largest ST location) rather than a sourced
/// fact; editable later in Settings.
/// </summary>
public class PlanningUnit
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public UnitKind Kind { get; set; }
    public GroupBy GroupBy { get; set; }
    public required string PrimaryLocationId { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public CompOffPolicy CompOffPolicy { get; set; } = new();

    public List<Location> Locations { get; set; } = [];
    public List<Shift> Shifts { get; set; } = [];
    public List<DayConfiguration> DayConfigurations { get; set; } = [];
    public List<AbsenceCapacityRule> AbsenceCapacityRules { get; set; } = [];
}
