using System.Text.Json;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure.Seed;

namespace ShiftOMator.Application.Tests.Differential;

/// <summary>
/// Runs the ported CoverageCalculator + Validator over the exact same seeded dataset
/// (fixture-dataset.json) the TypeScript client's own engines ran over, and compares
/// against a frozen export of their output (Differential/expected.json). This is the
/// one chance to prove the port is correct rather than merely re-asserting the same
/// unit-test cases the port was written to satisfy — it catches anything the ported
/// unit tests, written by the same hand that wrote the port, might share a blind spot
/// with. It stops being possible once the TypeScript engines are deleted (Phase 5), so
/// it runs here, not there.
///
/// Regenerate expected.json with `npx tsx` against a script that calls
/// computeCoverage/validate over createFixtureDataset() — see the script's header
/// comment for the exact shape expected here.
/// </summary>
public class EngineDifferentialTests
{
    private record ExpectedCoverageCell(string Date, string RoleId, int Actual, int Min, int? Max, string Level);
    private record ExpectedRegion(List<ExpectedCoverageCell> Coverage, List<string> IssueKeys, Dictionary<string, int> IssueCodeCounts);

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private static Dictionary<string, ExpectedRegion> LoadExpected()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Differential", "expected.json");
        using var stream = File.OpenRead(path);
        return JsonSerializer.Deserialize<Dictionary<string, ExpectedRegion>>(stream, JsonOptions)
            ?? throw new InvalidOperationException("expected.json deserialized to null");
    }

    public static TheoryData<string> Regions => ["AMER", "EMEA", "APAC"];

    [Theory]
    [MemberData(nameof(Regions))]
    public void Coverage_cells_match_the_TypeScript_engine_exactly(string regionId)
    {
        var expected = LoadExpected()[regionId];
        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);

        var from = new DateOnly(2026, 8, 1);
        var to = new DateOnly(2026, 8, 31);
        var cells = CoverageCalculator.Compute(regionId, from, to, dataset.Assignments, index);

        Assert.Equal(expected.Coverage.Count, cells.Count);

        var actualByKey = cells.ToDictionary(c => (c.Date, c.RoleId));
        foreach (var e in expected.Coverage)
        {
            var key = (DateOnly.Parse(e.Date), e.RoleId);
            Assert.True(actualByKey.TryGetValue(key, out var cell), $"Missing cell for {e.Date}/{e.RoleId}");
            Assert.Equal(e.Actual, cell!.Actual);
            Assert.Equal(e.Min, cell.Min);
            Assert.Equal(e.Max, cell.Max);
            Assert.Equal(e.Level, cell.Level.ToString().ToUpperInvariant());
        }
    }

    [Theory]
    [MemberData(nameof(Regions))]
    public void Issue_keys_match_the_TypeScript_engine_exactly(string regionId)
    {
        var expected = LoadExpected()[regionId];
        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);

        var from = new DateOnly(2026, 8, 1);
        var to = new DateOnly(2026, 8, 31);
        var asOf = new DateOnly(2026, 8, 15);

        var coverageCells = CoverageCalculator.Compute(regionId, from, to, dataset.Assignments, index);
        var issues = Validator.Validate(new Validator.ValidateParams(
            regionId, from, to, dataset.Assignments, dataset.Absences, dataset.CompDays,
            coverageCells, dataset.AbsenceCapacityRules, index, asOf));

        var actualKeys = issues.Select(i => i.Key).OrderBy(k => k, StringComparer.Ordinal).ToList();
        var expectedKeys = expected.IssueKeys.OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.Equal(expectedKeys, actualKeys);

        // issues[].Key already embeds the wire-format code (see Validator.MakeIssue);
        // splitting it back out keeps this assertion independent of Issue.Code's own
        // representation instead of re-deriving the SCREAMING_SNAKE_CASE conversion here.
        var actualCounts = issues.GroupBy(i => i.Key.Split('|')[0]).ToDictionary(g => g.Key, g => g.Count());
        Assert.Equal(expected.IssueCodeCounts, actualCounts);
    }
}
