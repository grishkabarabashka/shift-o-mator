namespace ShiftOMator.Domain;

/// <summary>Computed, never persisted. Key is stable across recomputations —
/// acknowledgements are matched by it.</summary>
public record Issue
{
    public required string Key { get; init; }
    public IssueLevel Level { get; init; }
    public IssueCategory Category { get; init; }
    public IssueCode Code { get; init; }
    public required string Message { get; init; }
    public required string UnitId { get; init; }
    public DateOnly? Date { get; init; }
    public string? PersonId { get; init; }
    public string? ShiftId { get; init; }
}
