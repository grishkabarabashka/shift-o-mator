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

public class Holiday
{
    public required string Id { get; set; }
    public required DateOnly Date { get; set; }
    public required string Name { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public bool IsFullDay { get; set; } = true;
}

/// <summary>Window-based accrual, not a fixed offset (ADR-0007, amended).</summary>
public class CompOffPolicy
{
    public int WindowBeforeDays { get; set; }
    public int WindowAfterDays { get; set; }
    public List<IsoWeekday> ExcludedWeekdays { get; set; } = [];
    public int AgingThresholdDays { get; set; }
    public bool RequiresApprovalWhenNoSlot { get; set; }
}

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

/// <summary>Belongs to a unit; no global shift catalog (ADR-0004, narrowed — the rule
/// boundary is now PlanningUnit, not Region). Carries an absolute window (ADR-0001) —
/// fixed regardless of who holds it or where they sit.</summary>
public class Shift
{
    public required string Id { get; set; }
    public required string UnitId { get; set; }
    public required string Code { get; set; }
    public required string Label { get; set; }
    public string? Description { get; set; }
    public required string Color { get; set; }
    public string? Hotkey { get; set; }
    public required string TimeZone { get; set; }
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public bool CrossesMidnight { get; set; }
    public int BreakMinutes { get; set; }
    public bool CountsAsCoverage { get; set; } = true;
    public bool EditableTime { get; set; }
}

/// <summary>Carries a shift set for a group of days, not just minimums (ADR-0016).
/// A zero-minimum requirement is legal — a unit may carry a shift with no coverage
/// obligation (Service Transition's day configurations, for one).</summary>
public class DayConfiguration
{
    public required string Id { get; set; }
    public required string UnitId { get; set; }
    public DayConfigKey Key { get; set; }
    public List<IsoWeekday> Weekdays { get; set; } = [];
    /// <summary>Only set when Key == Date.</summary>
    public DateOnly? Date { get; set; }
    public string? Label { get; set; }
    public required DateOnly EffectiveFrom { get; set; }

    public List<ShiftRequirement> ShiftRequirements { get; set; } = [];
}

public class ShiftRequirement
{
    public int Id { get; set; }
    public required string DayConfigurationId { get; set; }
    public required string ShiftId { get; set; }
    /// <summary>Hard minimum — below this is a gap. Zero is legal.</summary>
    public int Min { get; set; }
    /// <summary>Null = unlimited; above this is a warning, not a block.</summary>
    public int? Max { get; set; }
    public bool IsDefault { get; set; }
    public TimeOnly? TimingOverrideStart { get; set; }
    public TimeOnly? TimingOverrideEnd { get; set; }
    public bool? TimingOverrideCrossesMidnight { get; set; }
}

public class AbsenceCapacityRule
{
    public required string Id { get; set; }
    public required string UnitId { get; set; }
    public AbsenceCapacityScopeKind ScopeKind { get; set; }
    /// <summary>Set only when ScopeKind == ShiftPool.</summary>
    public string? ScopeShiftId { get; set; }
    public AbsenceDurationBucket DurationBucket { get; set; }
    public int LongThresholdWorkdays { get; set; }
    public int MaxConcurrent { get; set; }
    public List<AbsenceType> CountsTypes { get; set; } = [];
    public bool CountsCompDays { get; set; }
}
