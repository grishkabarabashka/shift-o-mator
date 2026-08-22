namespace ShiftOMator.Domain;

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

/// <summary>Child row of <see cref="DayConfiguration"/> — one per shift the
/// configuration carries, not an independent entity.</summary>
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
