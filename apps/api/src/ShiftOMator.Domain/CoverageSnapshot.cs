namespace ShiftOMator.Domain;

public record CoverageSnapshot
{
    public required DateOnly Date { get; init; }
    public required string UnitId { get; init; }
    public required IReadOnlyList<CoverageCell> Cells { get; init; }
    public int Headcount { get; init; }
    public int TotalRequired { get; init; }
    public int TotalFilled { get; init; }
}
