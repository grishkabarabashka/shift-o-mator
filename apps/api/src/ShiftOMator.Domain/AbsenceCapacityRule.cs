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
    /// <summary>Which event types count toward this limit (ADR-0049). Ids, not enum
    /// members — the set is data now.</summary>
    public List<string> CountsEventTypeIds { get; set; } = [];
    public bool CountsCompDays { get; set; }
}
