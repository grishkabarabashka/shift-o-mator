namespace ShiftOMator.Domain;

/// <summary>Append-only audit of published changes.</summary>
public class AssignmentHistoryEntry
{
    public required string Id { get; set; }
    public required string AssignmentId { get; set; }
    public HistoryAction Action { get; set; }
    /// <summary>Full snapshot at the time of the action; null for a delete.</summary>
    public string? SnapshotJson { get; set; }
    public required string ActorId { get; set; }
    public required DateTimeOffset At { get; set; }
}
