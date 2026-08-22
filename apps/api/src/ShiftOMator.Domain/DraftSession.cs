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
