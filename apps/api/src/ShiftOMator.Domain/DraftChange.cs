namespace ShiftOMator.Domain;

/// <summary>
/// Carries both Before and After — that is what buys undo/redo and the publish-conflict
/// diff screen almost for free (ADR-0015). Before/After are JSON snapshots of the typed
/// payload named by TargetType, the same way AssignmentHistoryEntry stores a snapshot:
/// a relational union of three entity shapes buys nothing a discriminated JSON blob
/// doesn't already give the one place (draft/publish service) that needs to branch on it.
/// </summary>
public class DraftChange
{
    public required string Id { get; set; }
    public required string DraftSessionId { get; set; }
    public int Seq { get; set; }
    public required DateTimeOffset At { get; set; }
    public DraftTargetType TargetType { get; set; }
    public DraftOp Op { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
}
