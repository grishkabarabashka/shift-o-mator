namespace ShiftOMator.Domain;

/// <summary>Computed, never persisted — mirrors domain/types.ts's CoverageCell.</summary>
public record CoverageCell
{
    public required DateOnly Date { get; init; }
    public required string RegionId { get; init; }
    public required string RoleId { get; init; }
    public int Actual { get; init; }
    public int Min { get; init; }
    public int? Max { get; init; }
    public CoverageLevel Level { get; init; }
    public DayConfigKey AppliedKey { get; init; }
    public string? RuleLabel { get; init; }
}

public record CoverageSnapshot
{
    public required DateOnly Date { get; init; }
    public required string RegionId { get; init; }
    public required IReadOnlyList<CoverageCell> Cells { get; init; }
    public int Headcount { get; init; }
    public int TotalRequired { get; init; }
    public int TotalFilled { get; init; }
}
