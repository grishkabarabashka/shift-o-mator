using System.Text.Json;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure.Seed;

namespace ShiftOMator.Application.Tests.Phase8Baseline;

/// <summary>
/// Freezes coverage + issues on the current (region-based) model before Phase 8 deletes
/// Region and ShiftDefinition and moves everything onto PlanningUnit. The differential
/// test that caught the last model-level bug (Phase 3, the IssueCode wire-format mismatch)
/// no longer exists — Phase 5 deleted the TypeScript engines it compared against — so this
/// is the replacement safety net for a migration that touches every engine at once.
///
/// baseline.json also records, per region, which shift/shift ids belong to a Service
/// Transition assignee (identified by ShiftId, not by unit — the current model has no
/// ST unit membership to key off yet) so Phase 8.7's comparison test can assert the
/// expected delta precisely: non-ST rows must be byte-identical after the migration,
/// ST rows must have relocated to unit-st with min=0 requirements.
///
/// Regenerate only if the fixture dataset itself changes before Phase 8 lands — run
/// `dotnet test --filter FullyQualifiedName~GenerateBaseline` and commit the result.
/// </summary>
public static class BaselineExporter
{
    public static readonly DateOnly From = new(2026, 8, 1);
    public static readonly DateOnly To = new(2026, 8, 31);

    public static readonly string[] Regions = ["AMER", "EMEA", "APAC"];

    // The ST shift ids that exist today, prefixed by their current region — these are
    // exactly the rows Phase 8.6 relocates into unit-st.
    public static readonly string[] ServiceTransitionRoleIds =
        ["AMER:ST", "AMER:ST Amer", "EMEA:ST EMEA", "APAC:ST APAC"];

    public record BaselineCell(string Date, string ShiftId, int Actual, int Min, int? Max, string Level, bool IsServiceTransition);
    public record BaselineRegion(List<BaselineCell> Coverage, List<string> IssueKeys, Dictionary<string, int> IssueCodeCounts);

    public static Dictionary<string, BaselineRegion> Build()
    {
        var dataset = FixtureSeeder.BuildScheduleDataset(includeDemoData: true);
        var index = DatasetIndex.Build(dataset);
        var asOf = new DateOnly(2026, 8, 15);
        var result = new Dictionary<string, BaselineRegion>();

        foreach (var regionId in Regions)
        {
            var cells = CoverageCalculator.Compute(regionId, From, To, dataset.Assignments, index);
            var issues = Validator.Validate(new Validator.ValidateParams(
                regionId, From, To, dataset.Assignments, dataset.Absences, dataset.CompDays,
                cells, dataset.AbsenceCapacityRules, index, asOf));

            result[regionId] = new BaselineRegion(
                cells.Select(c => new BaselineCell(
                        c.Date.ToString("yyyy-MM-dd"), c.ShiftId, c.Actual, c.Min, c.Max,
                        c.Level.ToString().ToUpperInvariant(), ServiceTransitionRoleIds.Contains(c.ShiftId)))
                    .OrderBy(c => c.Date, StringComparer.Ordinal).ThenBy(c => c.ShiftId, StringComparer.Ordinal)
                    .ToList(),
                issues.Select(i => i.Key).OrderBy(k => k, StringComparer.Ordinal).ToList(),
                issues.GroupBy(i => i.Key.Split('|')[0]).ToDictionary(g => g.Key, g => g.Count()));
        }

        return result;
    }

    public static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
}

/// <summary>Run once to (re)generate baseline.json; not part of the normal test run.</summary>
public class GenerateBaselineTests
{
    [Fact(Skip = "Generator, not an assertion — run explicitly with --filter to regenerate baseline.json.")]
    public void GenerateBaseline()
    {
        var baseline = BaselineExporter.Build();
        var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Phase8Baseline", "baseline.json");
        File.WriteAllText(path, JsonSerializer.Serialize(baseline, BaselineExporter.JsonOptions));
    }
}
