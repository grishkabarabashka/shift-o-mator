namespace ShiftOMator.Domain;

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
