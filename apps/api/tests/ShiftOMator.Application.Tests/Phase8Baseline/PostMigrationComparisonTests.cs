using System.Text.Json;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure.Seed;

namespace ShiftOMator.Application.Tests.Phase8Baseline;

/// <summary>
/// The actual safety-net check Phase 8.2's baseline.json exists for: run the *new*
/// (PlanningUnit-only) engines over the *new* (unit-based) seed and assert the expected
/// delta against the frozen pre-migration output, rather than trusting the migration by
/// construction. Region deleted, ShiftDefinition deleted, Service Transition split off
/// into unit-st with zero-minimum requirements — see phase-8-unit-model.md.
/// </summary>
public class PostMigrationComparisonTests
{
    private static readonly Dictionary<string, string> RegionToUnit = new()
    {
        ["AMER"] = "unit-amer",
        ["EMEA"] = "unit-emea",
        ["APAC"] = "unit-apac",
    };

    // Same rename table the fixture-dataset.json transform used — the baseline's ST
    // rows were captured under their old ids.
    private static readonly Dictionary<string, string> StShiftRename = new()
    {
        ["AMER:ST"] = "ST:AMER-Weekend",
        ["AMER:ST Amer"] = "ST:AMER",
        ["EMEA:ST EMEA"] = "ST:EMEA",
        ["APAC:ST APAC"] = "ST:APAC",
    };

    // The 11 people who moved from a region's screen onto unit-st. Any baseline issue
    // naming one of them, or one of the old ST shift ids, is expected to disappear from
    // its old region — it never really belonged there; Person.UnitId already said
    // unit-st even in the pre-migration data, region-scoped filtering just ignored it
    // (exactly the duplication bug this migration exists to fix).
    private static readonly string[] StPersonIds =
    [
        "p-curtis-aldridge", "p-bethany-whitaker", "p-marcus-lambert", "p-rachel-doyle",
        "p-imogen-lowry", "p-charlotte-cole", "p-sophie-whitmore", "p-hannah-fletcher",
        "p-siti-kumar", "p-mei-ling-tan", "p-cheryl-koh",
    ];

    private static Dictionary<string, BaselineExporter.BaselineRegion> LoadBaseline()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Phase8Baseline", "baseline.json");
        using var stream = File.OpenRead(path);
        return JsonSerializer.Deserialize<Dictionary<string, BaselineExporter.BaselineRegion>>(
            stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("baseline.json deserialized to null");
    }

    private static bool IsStIssueKey(string key)
    {
        // Key shape: Code|Date|PersonId|ShiftId (Validator.MakeIssue).
        var parts = key.Split('|');
        var personId = parts.Length > 2 ? parts[2] : "";
        var shiftId = parts.Length > 3 ? parts[3] : "";
        return StPersonIds.Contains(personId) || StShiftRename.ContainsKey(shiftId);
    }

    public static TheoryData<string> Regions => ["AMER", "EMEA", "APAC"];

    [Theory]
    [MemberData(nameof(Regions))]
    public void Non_ST_coverage_is_byte_identical_after_the_migration(string regionId)
    {
        var baseline = LoadBaseline()[regionId];
        var unitId = RegionToUnit[regionId];

        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);
        var cells = CoverageCalculator.Compute(unitId, BaselineExporter.From, BaselineExporter.To, dataset.Assignments, index);

        var expectedNonSt = baseline.Coverage.Where(c => !c.IsServiceTransition)
            .Select(c => (c.Date, c.ShiftId, c.Actual, c.Min, c.Max, c.Level))
            .OrderBy(c => c.Date, StringComparer.Ordinal).ThenBy(c => c.ShiftId, StringComparer.Ordinal)
            .ToList();
        var actual = cells
            .Select(c => (Date: c.Date.ToString("yyyy-MM-dd"), c.ShiftId, c.Actual, c.Min, c.Max, Level: c.Level.ToString().ToUpperInvariant()))
            .OrderBy(c => c.Date, StringComparer.Ordinal).ThenBy(c => c.ShiftId, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(expectedNonSt, actual);

        // Old ST shift ids must not appear in this unit's coverage at all — they relocated.
        Assert.DoesNotContain(cells, c => StShiftRename.ContainsKey(c.ShiftId));
    }

    [Theory]
    [MemberData(nameof(Regions))]
    public void Non_ST_issues_are_byte_identical_after_the_migration(string regionId)
    {
        var baseline = LoadBaseline()[regionId];
        var unitId = RegionToUnit[regionId];

        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);
        var asOf = new DateOnly(2026, 8, 15);
        var cells = CoverageCalculator.Compute(unitId, BaselineExporter.From, BaselineExporter.To, dataset.Assignments, index);
        var issues = Validator.Validate(new Validator.ValidateParams(
            unitId, BaselineExporter.From, BaselineExporter.To, dataset.Assignments, dataset.Absences, dataset.CompDays,
            cells, dataset.AbsenceCapacityRules, index, asOf));

        var expectedNonSt = baseline.IssueKeys.Where(k => !IsStIssueKey(k)).OrderBy(k => k, StringComparer.Ordinal).ToList();
        var actualNonSt = issues.Select(i => i.Key).Where(k => !IsStIssueKey(k)).OrderBy(k => k, StringComparer.Ordinal).ToList();

        Assert.Equal(expectedNonSt, actualNonSt);
    }

    [Fact]
    public void Service_Transition_shifts_relocate_into_unit_st_with_zero_minimums()
    {
        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);
        var cells = CoverageCalculator.Compute("unit-st", BaselineExporter.From, BaselineExporter.To, dataset.Assignments, index);

        Assert.NotEmpty(cells);
        Assert.Equal(StShiftRename.Values.OrderBy(x => x, StringComparer.Ordinal),
            cells.Select(c => c.ShiftId).Distinct().OrderBy(x => x, StringComparer.Ordinal));
        // "ST with zero limits now" — every requirement on unit-st is a zero minimum.
        Assert.All(cells, c => Assert.Equal(0, c.Min));
    }

    [Fact]
    public void A_zero_minimum_never_produces_a_coverage_gap_or_thin_issue()
    {
        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);
        var asOf = new DateOnly(2026, 8, 15);
        var cells = CoverageCalculator.Compute("unit-st", BaselineExporter.From, BaselineExporter.To, dataset.Assignments, index);
        var issues = Validator.Validate(new Validator.ValidateParams(
            "unit-st", BaselineExporter.From, BaselineExporter.To, dataset.Assignments, dataset.Absences, dataset.CompDays,
            cells, dataset.AbsenceCapacityRules, index, asOf));

        Assert.DoesNotContain(issues, i => i.Code is IssueCode.CoverageGap or IssueCode.CoverageThin);
    }
}
