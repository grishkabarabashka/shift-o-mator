namespace ShiftOMator.Domain;

/// <summary>Window-based accrual, not a fixed offset (ADR-0007, amended).</summary>
public class CompOffPolicy
{
    public int WindowBeforeDays { get; set; }
    public int WindowAfterDays { get; set; }
    public List<IsoWeekday> ExcludedWeekdays { get; set; } = [];
    public int AgingThresholdDays { get; set; }
    public bool RequiresApprovalWhenNoSlot { get; set; }
}
