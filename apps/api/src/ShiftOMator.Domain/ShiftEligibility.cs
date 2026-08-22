namespace ShiftOMator.Domain;

/// <summary>Target share is the fairness metric, not a boolean flag (ADR-0006).</summary>
public class ShiftEligibility
{
    public int Id { get; set; }
    public required string PersonId { get; set; }
    public required string ShiftId { get; set; }
    public double TargetShare { get; set; }
    public int? MinPerWeek { get; set; }
    public int? MaxPerWeek { get; set; }
}
