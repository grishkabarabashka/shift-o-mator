namespace ShiftOMator.Domain;

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
