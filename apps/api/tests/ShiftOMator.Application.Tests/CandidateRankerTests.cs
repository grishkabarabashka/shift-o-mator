using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/candidates.test.ts.</summary>
public class CandidateRankerTests
{
    // NOTE: Monday — a weekday for all fixtures.
    private static readonly DateOnly Date = new(2026, 9, 7);

    private static (DatasetIndex Index, Person Alice, Person Bob) Setup(List<Person>? people = null)
    {
        var alice = MakePerson("p-alice", displayName: "Alice");
        var bob = MakePerson("p-bob", displayName: "Bob");
        var dataset = MakeDataset(people: people ?? [alice, bob]);
        return (BuildIndex(dataset), alice, bob);
    }

    private static CandidateRanker.RankParams Params(
        DatasetIndex index, List<Assignment>? assignments = null, List<Absence>? absences = null,
        List<CompDayEntry>? compDays = null, IReadOnlySet<string>? excludePersonIds = null) =>
        new(LeadRole.Id, Date, TestUnit.Id, index, assignments ?? [], absences ?? [], compDays ?? [], excludePersonIds);

    [Fact]
    public void Excludes_someone_without_eligibility_for_the_role()
    {
        var notEligible = MakePerson("p-carl", displayName: "Carl", eligibility: []);
        var (index, _, _) = Setup([notEligible]);

        var result = CandidateRanker.Rank(Params(index));

        Assert.Empty(result.Available);
        Assert.Empty(result.Excluded); // NOTE: Not in the pool at all, not "excluded".
    }

    [Fact]
    public void Excludes_someone_on_leave_with_an_explanation()
    {
        var (index, _, _) = Setup();
        var absence = new Absence { Id = "abs-1", PersonId = "p-alice", EventTypeId = TestEventTypes.VacationId, From = new DateOnly(2026, 9, 5), To = new DateOnly(2026, 9, 10), Source = AbsenceSource.Manual };

        var result = CandidateRanker.Rank(Params(index, absences: [absence]));

        Assert.Equal(["p-bob"], result.Available.Select(c => c.PersonId));
        var excluded = Assert.Single(result.Excluded);
        Assert.Equal(// The reason names the actual type now, not a hard-coded word (ADR-0049).
            ("p-alice", "Alice", "on annual leave"), (excluded.PersonId, excluded.Name, excluded.Reason));
    }

    [Fact]
    public void Excludes_someone_on_a_confirmed_comp_day_but_not_a_proposed_one()
    {
        var (index, _, _) = Setup();
        var scheduled = new CompDayEntry { Id = "cd-1", PersonId = "p-alice", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 8, 30), Trigger = CompDayTrigger.Saturday, ActualDate = Date, Status = CompDayStatus.Scheduled };

        var result = CandidateRanker.Rank(Params(index, compDays: [scheduled]));
        Assert.Equal(["p-bob"], result.Available.Select(c => c.PersonId));

        var proposed = new CompDayEntry { Id = "cd-2", PersonId = "p-alice", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 8, 30), Trigger = CompDayTrigger.Saturday, ActualDate = Date, Status = CompDayStatus.Proposed };
        var stillAvailable = CandidateRanker.Rank(Params(index, compDays: [proposed]));
        Assert.Equal(["p-alice", "p-bob"], stillAvailable.Available.Select(c => c.PersonId).OrderBy(x => x));
    }

    [Fact]
    public void Excludes_by_unavailable_weekday_and_blackout_date()
    {
        var weekdayOnly = MakePerson("p-carl", displayName: "Carl", availableWeekdays: [IsoWeekday.Saturday, IsoWeekday.Sunday]);
        var blackedOut = MakePerson("p-dora", displayName: "Dora", preferences: new PersonPreferences { BlackoutDates = [Date] });
        var (index, _, _) = Setup([weekdayOnly, blackedOut]);

        var result = CandidateRanker.Rank(Params(index));

        var reasons = result.Excluded.ToDictionary(e => e.PersonId, e => e.Reason);
        Assert.Equal("not available this weekday", reasons["p-carl"]);
        Assert.Equal("blackout date", reasons["p-dora"]);
    }

    [Fact]
    public void Ranks_higher_whoever_held_the_role_less_in_90_days()
    {
        var (index, _, _) = Setup();
        var assignments = new List<Assignment>
        {
            MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 8, 10)),
            MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 8, 17)),
            MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 8, 24)),
        };

        var result = CandidateRanker.Rank(Params(index, assignments));

        // NOTE: Bob never held the role — he comes first, despite the alphabet.
        Assert.Equal(["p-bob", "p-alice"], result.Available.Select(c => c.PersonId));
        Assert.Equal(3, result.Available[1].ShiftCountLast90);
    }

    [Fact]
    public void Assignments_outside_the_90_day_window_do_not_count()
    {
        var (index, _, _) = Setup();
        // NOTE: 95 days before DATE — already outside the window.
        var assignments = new List<Assignment> { MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 6, 4)) };

        var result = CandidateRanker.Rank(Params(index, assignments));

        Assert.Equal(0, result.Available.First(c => c.PersonId == "p-alice").ShiftCountLast90);
    }

    [Fact]
    public void A_long_ago_holder_is_pushed_down_by_a_recent_one()
    {
        var (index, _, _) = Setup();
        var assignments = new List<Assignment>
        {
            MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 9, 1)), // NOTE: 6 days ago.
            MakeAssignment("p-bob", LeadRole.Id, new DateOnly(2026, 8, 1)),   // NOTE: 37 days ago.
        };

        var result = CandidateRanker.Rank(Params(index, assignments));

        // NOTE: Both held it exactly once — recency decides: Bob held it longer ago.
        Assert.Equal(["p-bob", "p-alice"], result.Available.Select(c => c.PersonId));
    }

    [Fact]
    public void Exceeding_the_weekly_maximum_demotes_but_does_not_exclude()
    {
        var capped = MakePerson("p-eve", displayName: "Eve",
            eligibility: [new ShiftEligibility { PersonId = "", ShiftId = LeadRole.Id, TargetShare = 1, MaxPerWeek = 1 }]);
        var (index, _, _) = Setup([capped]);
        // NOTE: Already one shift this ISO week (DATE is a Monday in the same week).
        var assignments = new List<Assignment> { MakeAssignment("p-eve", LeadRole.Id, new DateOnly(2026, 9, 8)) };

        var result = CandidateRanker.Rank(Params(index, assignments));

        Assert.Contains("p-eve", result.Available.Select(c => c.PersonId));
        var eve = result.Available.First(c => c.PersonId == "p-eve");
        Assert.Equal(["would exceed 1 shifts this week"], eve.Warnings);
    }

    [Fact]
    public void People_already_busy_today_land_in_excluded_with_an_honest_reason()
    {
        // WHY: Previously such people disappeared without a trace — the only
        // eligible person, busy with another role, turned "busy" into a false
        // "no one is eligible".
        var (index, _, _) = Setup();

        var result = CandidateRanker.Rank(Params(index, excludePersonIds: new HashSet<string> { "p-alice" }));

        Assert.Equal(["p-bob"], result.Available.Select(c => c.PersonId));
        var excluded = Assert.Single(result.Excluded);
        Assert.Equal(("p-alice", "Alice", "already assigned to something else that day"), (excluded.PersonId, excluded.Name, excluded.Reason));
    }

    [Fact]
    public void Order_is_deterministic_when_candidates_are_fully_tied()
    {
        var (index, _, _) = Setup();
        List<string> Run() => [.. CandidateRanker.Rank(Params(index)).Available.Select(c => c.PersonId)];

        Assert.Equal(Run(), Run());
        Assert.Equal(["p-alice", "p-bob"], Run()); // NOTE: Alphabetical tie-break.
    }
}
