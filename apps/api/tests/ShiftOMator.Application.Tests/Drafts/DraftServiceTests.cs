using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests.Drafts;

public class DraftServiceTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-03-02T10:00:00Z");
    private static readonly DateOnly Monday = new(2026, 3, 2);
    private static readonly DateOnly Tuesday = new(2026, 3, 3);

    private static (ScheduleDataset Dataset, DatasetIndex Index) MakeWorld(params Assignment[] existing)
    {
        var person = TestFixtures.MakePerson("p-1");
        var dataset = TestFixtures.MakeDataset(people: [person], assignments: [.. existing]);
        return (dataset, DatasetIndex.Build(dataset));
    }

    private static Assignment NewAssignment(DateOnly date, int version = 0, string id = "as-1") => new()
    {
        Id = id,
        PersonId = "p-1",
        Date = date,
        UnitId = TestFixtures.TestUnit.Id,
        ContentKind = AssignmentContentKind.Shift,
        ShiftId = TestFixtures.LeadRole.Id,
        Source = AssignmentSource.Manual,
        Version = version,
        CreatedBy = "p-1",
        CreatedAt = Now,
    };

    // -------------------------------------------------------------------------
    // Append-time validation
    // -------------------------------------------------------------------------

    [Fact]
    public void Open_creates_a_session_in_Open_status()
    {
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);
        Assert.Equal(DraftStatus.Open, session.Status);
        Assert.Empty(session.Changes);
    }

    [Fact]
    public void Append_create_assigns_sequential_seq_numbers()
    {
        var (_, index) = MakeWorld();
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);

        var c1 = DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday, id: "as-1"), index, Now);
        var c2 = DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Tuesday, id: "as-2"), index, Now);

        Assert.Equal(1, c1.Seq);
        Assert.Equal(2, c2.Seq);
        Assert.Equal(2, session.Changes.Count);
    }

    [Fact]
    public void Append_create_rejects_a_role_belonging_to_another_unit()
    {
        var shift = new Shift
        {
            Id = "r-other", UnitId = "unit-2", Code = "Lead", Label = "Lead", Color = "#000",
            TimeZone = "America/New_York", Start = new TimeOnly(9, 0), End = new TimeOnly(17, 0),
        };
        var person = TestFixtures.MakePerson("p-1");
        var dataset = TestFixtures.MakeDataset(people: [person], shifts: [TestFixtures.LeadRole, shift]);
        var index = DatasetIndex.Build(dataset);
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);

        var after = NewAssignment(Monday);
        after.ShiftId = shift.Id;

        var ex = Assert.Throws<DraftDomainException>(() =>
            DraftService.AppendAssignmentChange(session, DraftOp.Create, null, after, index, Now));
        Assert.Equal("SHIFT_OUTSIDE_UNIT", ex.Code);
    }

    [Fact]
    public void Append_create_rejects_a_cell_already_occupied_in_the_current_state()
    {
        var (_, index) = MakeWorld(NewAssignment(Monday, id: "as-existing"));
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);

        var ex = Assert.Throws<DraftDomainException>(() =>
            DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday, id: "as-new"), index, Now));
        Assert.Equal("CELL_OCCUPIED", ex.Code);
    }

    [Fact]
    public void Remove_change_takes_it_out_of_the_session()
    {
        var (_, index) = MakeWorld();
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);
        var change = DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday), index, Now);

        DraftService.RemoveChange(session, change.Id);

        Assert.Empty(session.Changes);
    }

    [Fact]
    public void Discard_moves_status_and_further_appends_fail()
    {
        var (_, index) = MakeWorld();
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);
        DraftService.Discard(session, Now);

        Assert.Equal(DraftStatus.Discarded, session.Status);
        Assert.Throws<DraftDomainException>(() =>
            DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday), index, Now));
    }

    // -------------------------------------------------------------------------
    // Publish
    // -------------------------------------------------------------------------

    [Fact]
    public void Publish_applies_a_create_and_writes_a_history_entry()
    {
        var (dataset, index) = MakeWorld();
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);
        DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday), index, Now);

        var outcome = DraftService.Publish(dataset, index, session, "p-planner", Now);

        Assert.True(outcome.Success);
        Assert.Single(outcome.Assignments);
        Assert.Single(outcome.History);
        Assert.Equal(HistoryAction.Created, outcome.History[0].Action);
        Assert.Equal(1, outcome.Assignments[0].Version);
    }

    [Fact]
    public void Publish_fails_atomically_when_a_second_draft_already_took_the_cell()
    {
        var (dataset, index) = MakeWorld();
        var sessionA = DraftService.Open("p-a", "unit-1", Monday, Tuesday, Now);
        var sessionB = DraftService.Open("p-b", "unit-1", Monday, Tuesday, Now);

        DraftService.AppendAssignmentChange(sessionA, DraftOp.Create, null, NewAssignment(Monday, id: "as-a"), index, Now);
        DraftService.AppendAssignmentChange(sessionB, DraftOp.Create, null, NewAssignment(Monday, id: "as-b"), index, Now);

        var outcomeA = DraftService.Publish(dataset, index, sessionA, "p-a", Now);
        Assert.True(outcomeA.Success);

        // Publishing A moved the plan; B is republished against the *current* state,
        // which now has the cell filled — not the state B's own index was built from.
        var postDataset = TestFixtures.MakeDataset(people: dataset.People.ToList(), assignments: [.. outcomeA.Assignments]);
        var postIndex = DatasetIndex.Build(postDataset);
        var outcomeB = DraftService.Publish(postDataset, postIndex, sessionB, "p-b", Now);

        Assert.False(outcomeB.Success);
        Assert.Single(outcomeB.Conflicts);
        Assert.Equal(DraftTargetType.Assignment, outcomeB.Conflicts[0].TargetType);
        Assert.Empty(outcomeB.Assignments);
    }

    [Fact]
    public void Publish_fails_on_a_stale_version_for_an_update()
    {
        var existing = NewAssignment(Monday, version: 1, id: "as-1");
        var (dataset, index) = MakeWorld(existing);
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);

        var stillV1 = NewAssignment(Monday, version: 1, id: "as-1");
        var updated = NewAssignment(Monday, version: 1, id: "as-1");
        updated.Note = "moved";
        DraftService.AppendAssignmentChange(session, DraftOp.Update, stillV1, updated, index, Now);

        // Someone else bumps the version in the meantime.
        var bumped = NewAssignment(Monday, version: 2, id: "as-1");
        var movedDataset = TestFixtures.MakeDataset(people: dataset.People.ToList(), assignments: [bumped]);
        var movedIndex = DatasetIndex.Build(movedDataset);

        var outcome = DraftService.Publish(movedDataset, movedIndex, session, "p-planner", Now);

        Assert.False(outcome.Success);
        Assert.Contains(outcome.Conflicts, c => c.EntityId == "as-1");
    }

    [Fact]
    public void Publish_computes_remaining_gaps_from_the_post_publish_coverage()
    {
        var dayConfig = TestFixtures.MakeDayConfig(
            "dc-1", DayConfigKey.Weekday,
            roleRequirements: [new ShiftRequirement { DayConfigurationId = "dc-1", ShiftId = TestFixtures.LeadRole.Id, Min = 2 }]);
        var dataset = TestFixtures.MakeDataset(
            people: [TestFixtures.MakePerson("p-1")],
            dayConfigurations: [dayConfig]);
        var index = DatasetIndex.Build(dataset);
        var session = DraftService.Open("p-planner", "unit-1", Monday, Monday, Now);
        DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(Monday), index, Now);

        var outcome = DraftService.Publish(dataset, index, session, "p-planner", Now);

        Assert.True(outcome.Success);
        // Minimum 2, only 1 assigned — one gap remains, not the old hardcoded 0.
        Assert.Equal(1, outcome.RemainingGaps);
    }

    [Fact]
    public void Publish_generates_comp_day_accrual_for_a_weekend_assignment()
    {
        var saturday = new DateOnly(2026, 3, 7);
        var person = TestFixtures.MakePerson("p-1");
        var dataset = TestFixtures.MakeDataset(people: [person]);
        var index = DatasetIndex.Build(dataset);
        var session = DraftService.Open("p-planner", "unit-1", saturday, saturday, Now);
        DraftService.AppendAssignmentChange(session, DraftOp.Create, null, NewAssignment(saturday, id: "as-sat"), index, Now);

        var outcome = DraftService.Publish(dataset, index, session, "p-planner", Now);

        Assert.True(outcome.Success);
        Assert.Single(outcome.GeneratedCompDays);
        Assert.Equal(CompDayTrigger.Saturday, outcome.GeneratedCompDays[0].Trigger);
    }

    [Fact]
    public void Publish_rejects_a_draft_that_is_not_open()
    {
        var (dataset, index) = MakeWorld();
        var session = DraftService.Open("p-planner", "unit-1", Monday, Tuesday, Now);
        DraftService.Discard(session, Now);

        var outcome = DraftService.Publish(dataset, index, session, "p-planner", Now);

        Assert.False(outcome.Success);
    }
}
