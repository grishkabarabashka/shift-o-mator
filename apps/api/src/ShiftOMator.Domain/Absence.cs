namespace ShiftOMator.Domain;

/// <summary>The range is the source of truth; the grid cell is a projection (ADR-0017).</summary>
public class Absence
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public AbsenceType Type { get; set; }
    public required DateOnly From { get; set; }
    public required DateOnly To { get; set; }
    public AbsenceSource Source { get; set; }
    /// <summary>Which import produced this record — the actual rollback path is Undo
    /// on the client's draft (ADR-0028); this only marks provenance.</summary>
    public string? ImportBatchId { get; set; }
    /// <summary>Detects records that vanished from a later import.</summary>
    public DateTimeOffset? LastSeenInImportAt { get; set; }
    public DateTimeOffset? SyncedToHrAt { get; set; }
    public string? Note { get; set; }
}
