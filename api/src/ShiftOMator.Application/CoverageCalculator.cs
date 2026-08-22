using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/coverage.ts. Computed per *region*, not planning unit (ADR-0020) — a
/// requirement belongs to the region, and a gap in `ST Amer` must show on the AMER
/// strip even when those people are planned from a different unit.
/// </summary>
public static class CoverageCalculator
{
    /// <summary>THIN is its own state, not a shade of green: minimum met exactly is the
    /// most actionable signal there is — "we're covered, but one sick day from a gap."</summary>
    public static CoverageLevel Level(int actual, int min, int? max = null)
    {
        if (actual < min) return CoverageLevel.Gap;
        if (max is not null && actual > max) return CoverageLevel.Over;
        if (min > 0 && actual == min) return CoverageLevel.Thin;
        return CoverageLevel.Ok;
    }

    /// <summary>Cells are returned only for (role, day) pairs with an active requirement
    /// — nothing to show where there's no requirement.</summary>
    public static List<CoverageCell> Compute(
        string regionId, DateOnly from, DateOnly to, IEnumerable<Assignment> assignments, DatasetIndex index)
    {
        var actualBy = new Dictionary<(DateOnly, string), int>();
        foreach (var a in assignments)
        {
            if (a.Date < from || a.Date > to) continue;
            if (a.RegionId != regionId) continue;
            if (a.ContentKind != AssignmentContentKind.Role || a.RoleId is null) continue;
            if (!index.Roles.TryGetValue(a.RoleId, out var role) || !role.CountsAsCoverage) continue;
            var key = (a.Date, a.RoleId);
            actualBy[key] = actualBy.GetValueOrDefault(key) + 1;
        }

        var cells = new List<CoverageCell>();
        foreach (var date in DateHelpers.EachDate(from, to))
        {
            var config = DayConfigurationResolver.Resolve(regionId, date, index);
            if (config is null) continue;

            foreach (var requirement in config.RoleRequirements)
            {
                if (!index.Roles.TryGetValue(requirement.RoleId, out var role) || !role.CountsAsCoverage) continue;
                var actual = actualBy.GetValueOrDefault((date, requirement.RoleId));
                cells.Add(new CoverageCell
                {
                    Date = date,
                    RegionId = regionId,
                    RoleId = requirement.RoleId,
                    Actual = actual,
                    Min = requirement.Min,
                    Max = requirement.Max,
                    Level = Level(actual, requirement.Min, requirement.Max),
                    AppliedKey = config.Key,
                    RuleLabel = config.Label,
                });
            }
        }
        return cells;
    }

    public static List<CoverageSnapshot> SnapshotsByDate(
        IReadOnlyList<CoverageCell> cells, string regionId, IReadOnlyDictionary<DateOnly, int> headcountByDate)
    {
        var byDate = cells.GroupBy(c => c.Date).OrderBy(g => g.Key);
        return byDate.Select(g => new CoverageSnapshot
        {
            Date = g.Key,
            RegionId = regionId,
            Cells = g.ToList(),
            Headcount = headcountByDate.GetValueOrDefault(g.Key),
            TotalRequired = g.Sum(c => c.Min),
            TotalFilled = g.Sum(c => c.Actual),
        }).ToList();
    }

    public record CoverageSummary(int Gaps, int Thin, int Over, int Total);

    public static CoverageSummary Summarize(IReadOnlyList<CoverageCell> cells)
    {
        int gaps = 0, thin = 0, over = 0;
        foreach (var cell in cells)
        {
            if (cell.Level == CoverageLevel.Gap) gaps++;
            else if (cell.Level == CoverageLevel.Thin) thin++;
            else if (cell.Level == CoverageLevel.Over) over++;
        }
        return new CoverageSummary(gaps, thin, over, cells.Count);
    }

    public static Dictionary<(DateOnly, string), CoverageCell> Index(IEnumerable<CoverageCell> cells) =>
        cells.ToDictionary(c => (c.Date, c.RoleId));

    public static List<string> RolesIn(IReadOnlyList<CoverageCell> cells)
    {
        var seen = new HashSet<string>();
        var result = new List<string>();
        foreach (var cell in cells)
        {
            if (!seen.Add(cell.RoleId)) continue;
            result.Add(cell.RoleId);
        }
        return result;
    }
}
