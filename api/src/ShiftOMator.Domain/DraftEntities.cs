namespace ShiftOMator.Domain;

/// <summary>One editor + one unit + one period (ADR-0015). Concurrent drafts are
/// allowed; conflicts resolve at publish, not by locking.</summary>
public class DraftSession
{
    public required string Id { get; set; }
    public required string EditorPersonId { get; set; }
    public required string UnitId { get; set; }
    public required DateOnly RangeFrom { get; set; }
    public required DateOnly RangeTo { get; set; }
    public DraftStatus Status { get; set; }
    public required DateTimeOffset CreatedAt { get; set; }
    public required DateTimeOffset UpdatedAt { get; set; }

    public List<DraftChange> Changes { get; set; } = [];
}

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
