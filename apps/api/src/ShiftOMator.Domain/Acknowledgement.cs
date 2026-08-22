namespace ShiftOMator.Domain;

/// <summary>Evaluates a plan, not part of it — an acknowledgement bypasses the draft
/// the same way a person-profile edit does (ADR-0009, ADR-0024).</summary>
public class Acknowledgement
{
    public int Id { get; set; }
    /// <summary>Stable across recomputations — matched by string key, not a foreign key.</summary>
    public required string IssueKey { get; set; }
    public required string Comment { get; set; }
    public required string ByPersonId { get; set; }
    public required DateTimeOffset At { get; set; }
}
