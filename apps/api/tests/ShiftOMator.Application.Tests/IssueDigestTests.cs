using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// The digest is the load-bearing half of the gap summary: the prose layer above it only
/// phrases what these lines say, so an error here becomes an error a manager reads as
/// fact. Counting, grouping and ordering are therefore pinned by tests; the wording is
/// not (and cannot be).
/// </summary>
public class IssueDigestTests
{
    private static readonly DateOnly From = new(2026, 9, 1);
    private static readonly DateOnly To = new(2026, 9, 30);

    private static DatasetIndex Index() => BuildIndex(MakeDataset());

    private static Issue Gap(DateOnly date, string shiftId, string message = "Below minimum") => new()
    {
        Key = $"gap|{date:yyyy-MM-dd}|{shiftId}",
        Level = IssueLevel.Warning,
        Category = IssueCategory.Gap,
        Code = IssueCode.CoverageGap,
        Message = message,
        UnitId = TestUnit.Id,
        Date = date,
        ShiftId = shiftId,
    };

    [Fact]
    public void Groups_the_same_finding_across_dates_into_one_line()
    {
        var issues = new List<Issue>
        {
            Gap(new DateOnly(2026, 9, 4), LeadRole.Id),
            Gap(new DateOnly(2026, 9, 11), LeadRole.Id),
            Gap(new DateOnly(2026, 9, 18), LeadRole.Id),
        };

        var digest = IssueDigest.Build(TestUnit.Id, From, To, issues, new HashSet<string>(), Index());

        var line = Assert.Single(digest.Lines);
        Assert.Equal(3, line.Count);
        Assert.Equal(3, line.Dates.Count);
        // NOTE: the shift is named by its code, not its id — the digest is read by people.
        Assert.Equal(LeadRole.Code, line.Subject);
        Assert.Equal(3, digest.Gaps);
        Assert.Equal(3, digest.Total);
    }

    [Fact]
    public void Counts_categories_and_levels_separately()
    {
        var issues = new List<Issue>
        {
            Gap(new DateOnly(2026, 9, 4), LeadRole.Id),
            new()
            {
                Key = "conflict|1", Level = IssueLevel.Warning, Category = IssueCategory.Conflict,
                Code = IssueCode.AssignedDuringAbsence, Message = "Rostered while on leave",
                UnitId = TestUnit.Id, Date = new DateOnly(2026, 9, 7), PersonId = "p-1",
            },
            new()
            {
                Key = "double|1", Level = IssueLevel.Blocking, Category = IssueCategory.Conflict,
                Code = IssueCode.DoubleAssignment, Message = "Two assignments in one cell",
                UnitId = TestUnit.Id, Date = new DateOnly(2026, 9, 8), PersonId = "p-1",
            },
        };

        var digest = IssueDigest.Build(TestUnit.Id, From, To, issues, new HashSet<string>(), Index());

        Assert.Equal(1, digest.Gaps);
        Assert.Equal(2, digest.Conflicts);
        Assert.Equal(2, digest.Warnings);
        Assert.Equal(1, digest.Blocking);
    }

    [Fact]
    public void Blocking_findings_come_first()
    {
        var issues = new List<Issue>
        {
            Gap(new DateOnly(2026, 9, 4), LeadRole.Id),
            Gap(new DateOnly(2026, 9, 5), LeadRole.Id),
            new()
            {
                Key = "double|1", Level = IssueLevel.Blocking, Category = IssueCategory.Conflict,
                Code = IssueCode.DoubleAssignment, Message = "Two assignments in one cell",
                UnitId = TestUnit.Id, Date = new DateOnly(2026, 9, 8), PersonId = "p-1",
            },
        };

        var digest = IssueDigest.Build(TestUnit.Id, From, To, issues, new HashSet<string>(), Index());

        Assert.Equal(IssueLevel.Blocking, digest.Lines[0].Level);
    }

    [Fact]
    public void Acknowledged_findings_are_counted_but_still_reported()
    {
        var issue = Gap(new DateOnly(2026, 9, 4), LeadRole.Id);
        var digest = IssueDigest.Build(
            TestUnit.Id, From, To, [issue], new HashSet<string> { issue.Key }, Index());

        Assert.Equal(1, digest.Acknowledged);
        Assert.Single(digest.Lines);
    }

    [Fact]
    public void A_long_run_of_dates_is_summarized_as_a_span()
    {
        var issues = Enumerable.Range(1, 20)
            .Select(day => Gap(new DateOnly(2026, 9, day), LeadRole.Id))
            .ToList();

        var text = IssueDigest.Render(IssueDigest.Build(TestUnit.Id, From, To, issues, new HashSet<string>(), Index()));

        Assert.Contains("20 dates from 2026-09-01 to 2026-09-20", text);
    }

    [Fact]
    public void An_empty_period_renders_as_such()
    {
        var text = IssueDigest.Render(IssueDigest.Build(TestUnit.Id, From, To, [], new HashSet<string>(), Index()));
        Assert.Contains("No issues found", text);
    }
}
