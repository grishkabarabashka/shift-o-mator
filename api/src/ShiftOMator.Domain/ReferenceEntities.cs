namespace ShiftOMator.Domain;

/// <summary>Calendar and display timezone only — nothing to do with role timing (ADR-0002).</summary>
public class Location
{
    public required string Id { get; set; }
    public required string Name { get; set; }
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

/// <summary>The rule boundary — which requirements, roles and policy apply (ADR-0020).</summary>
public class Region
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string PrimaryTimeZone { get; set; }
    public required string PrimaryLocationId { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public CompOffPolicy CompOffPolicy { get; set; } = new();

    public List<Location> Locations { get; set; } = [];
    public List<ShiftRole> Roles { get; set; } = [];
    public List<ShiftDefinition> Shifts { get; set; } = [];
    public List<DayConfiguration> DayConfigurations { get; set; } = [];
    public List<AbsenceCapacityRule> AbsenceCapacityRules { get; set; } = [];
}

/// <summary>The planning boundary — whose screen, orthogonal to Region (ADR-0020).</summary>
public class PlanningUnit
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public UnitKind Kind { get; set; }
    /// <summary>Set only when Kind == Region.</summary>
    public string? RegionId { get; set; }
    public GroupBy GroupBy { get; set; }
}

/// <summary>A person's contracted window — distinct from a role's duty window (ADR-0018).</summary>
public class ShiftDefinition
{
    public required string Id { get; set; }
    public required string RegionId { get; set; }
    public required string Code { get; set; }
    public required string Name { get; set; }
    public required string TimeZone { get; set; }
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public bool CrossesMidnight { get; set; }
    public int BreakMinutes { get; set; }
}

/// <summary>Belongs to a region; no global role catalog (ADR-0004).</summary>
public class ShiftRole
{
    public required string Id { get; set; }
    public required string RegionId { get; set; }
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

/// <summary>Carries a role set for a group of days, not just minimums (ADR-0016).</summary>
public class DayConfiguration
{
    public required string Id { get; set; }
    public required string RegionId { get; set; }
    public DayConfigKey Key { get; set; }
    public List<IsoWeekday> Weekdays { get; set; } = [];
    /// <summary>Only set when Key == Date.</summary>
    public DateOnly? Date { get; set; }
    public string? Label { get; set; }
    public required DateOnly EffectiveFrom { get; set; }

    public List<RoleRequirement> RoleRequirements { get; set; } = [];
}

public class RoleRequirement
{
    public int Id { get; set; }
    public required string DayConfigurationId { get; set; }
    public required string RoleId { get; set; }
    /// <summary>Hard minimum — below this is a gap.</summary>
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
    public required string RegionId { get; set; }
    public AbsenceCapacityScopeKind ScopeKind { get; set; }
    /// <summary>Set only when ScopeKind == RolePool.</summary>
    public string? ScopeRoleId { get; set; }
    public AbsenceDurationBucket DurationBucket { get; set; }
    public int LongThresholdWorkdays { get; set; }
    public int MaxConcurrent { get; set; }
    public List<AbsenceType> CountsTypes { get; set; } = [];
    public bool CountsCompDays { get; set; }
}
