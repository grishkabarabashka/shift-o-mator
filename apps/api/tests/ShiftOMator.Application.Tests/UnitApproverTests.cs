using ShiftOMator.Application.Requests;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Who decides a request: the people holding <see cref="AppRole.Approver"/> in the
/// subject's planning unit (ADR-0051).
///
/// This replaced an ordered multi-step route table. The property worth keeping from it is
/// the one these tests are mostly about: a request must never resolve to nobody, because
/// an empty inbox is the failure nobody notices.
/// </summary>
public class UnitApproverTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    private static Person Person(string id, string unitId = "unit-amer", bool active = true) => new()
    {
        Id = id,
        DisplayName = id,
        Initials = id[..2].ToUpperInvariant(),
        UnitId = unitId,
        LocationId = "loc-chicago",
        OrgCategory = OrgCategory.Support,
        IsActive = active,
        CalendarToken = $"tok-{id}",
    };

    private static RoleAssignment Grant(string personId, AppRole role, string? unitId) => new()
    {
        Id = $"{personId}-{role}-{unitId ?? "global"}",
        PersonId = personId,
        UnitId = unitId,
        Role = role,
        GrantedBy = "p-admin",
        GrantedAt = Now,
    };

    private static RequestType Type() => new()
    {
        Id = "rt-remote",
        Code = "REMOTE",
        Label = "Work remotely",
        Category = RequestCategory.Presence,
        Materializer = RequestMaterializer.Presence,
        PresenceTypeId = PresenceTypeIds.Remote,
    };

    private static Request Open(Person subject) =>
        RequestService.Open(Type(), subject, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 7),
            null, null, subject.Id, Now);

    [Fact]
    public void Resolves_to_the_approvers_of_the_subjects_unit()
    {
        var subject = Person("p-alice");
        var people = new List<Person> { subject, Person("p-approver") };
        var roles = new List<RoleAssignment> { Grant("p-approver", AppRole.Approver, "unit-amer") };

        Assert.Equal(["p-approver"], RequestService.ApproversFor(Open(subject), roles, people));
    }

    [Fact]
    public void An_approver_of_another_unit_does_not_resolve()
    {
        // The whole point of scoping the grant: approving EMEA's leave says nothing about
        // approving AMER's.
        var subject = Person("p-alice", "unit-amer");
        var people = new List<Person> { subject, Person("p-emea", "unit-emea"), Person("p-admin") };
        var roles = new List<RoleAssignment>
        {
            Grant("p-emea", AppRole.Approver, "unit-emea"),
            Grant("p-admin", AppRole.Admin, null),
        };

        var approvers = RequestService.ApproversFor(Open(subject), roles, people);

        Assert.DoesNotContain("p-emea", approvers);
    }

    [Fact]
    public void A_global_grant_covers_every_unit()
    {
        var subject = Person("p-alice", "unit-apac");
        var people = new List<Person> { subject, Person("p-anywhere") };
        var roles = new List<RoleAssignment> { Grant("p-anywhere", AppRole.Approver, null) };

        Assert.Equal(["p-anywhere"], RequestService.ApproversFor(Open(subject), roles, people));
    }

    [Fact]
    public void Someone_who_left_is_dropped()
    {
        var subject = Person("p-alice");
        var people = new List<Person> { subject, Person("p-gone", active: false), Person("p-admin") };
        var roles = new List<RoleAssignment>
        {
            Grant("p-gone", AppRole.Approver, "unit-amer"),
            Grant("p-admin", AppRole.Admin, null),
        };

        var approvers = RequestService.ApproversFor(Open(subject), roles, people);

        Assert.DoesNotContain("p-gone", approvers);
        Assert.Equal(["p-admin"], approvers);
    }

    [Fact]
    public void A_unit_with_no_approvers_falls_through_to_admins_rather_than_stalling()
    {
        // A request routed to nobody sits in Submitted forever and shows up in no inbox.
        // Admins are the fallback because they are the people who can fix the cause.
        var subject = Person("p-alice");
        var people = new List<Person> { subject, Person("p-admin") };
        var roles = new List<RoleAssignment> { Grant("p-admin", AppRole.Admin, null) };

        Assert.Equal(["p-admin"], RequestService.ApproversFor(Open(subject), roles, people));
        Assert.True(RequestService.IsUnrouted(Open(subject), roles));
    }

    [Fact]
    public void A_properly_configured_unit_is_not_flagged_as_unrouted()
    {
        var subject = Person("p-alice");
        var roles = new List<RoleAssignment> { Grant("p-approver", AppRole.Approver, "unit-amer") };

        Assert.False(RequestService.IsUnrouted(Open(subject), roles));
    }

    [Fact]
    public void Being_a_planner_does_not_make_you_an_approver()
    {
        // Roles are a set, not a ladder (ADR-0051): owning the rota is not the same job as
        // deciding who gets leave, and the old ordinal quietly conflated the two.
        var subject = Person("p-alice");
        var people = new List<Person> { subject, Person("p-planner") };
        var roles = new List<RoleAssignment> { Grant("p-planner", AppRole.Planner, "unit-amer") };

        Assert.False(RequestService.CanDecide(Open(subject), "p-planner", roles, people));
    }

    [Fact]
    public void Holding_both_roles_grants_both()
    {
        var subject = Person("p-alice");
        var people = new List<Person> { subject, Person("p-both") };
        var roles = new List<RoleAssignment>
        {
            Grant("p-both", AppRole.Planner, "unit-amer"),
            Grant("p-both", AppRole.Approver, "unit-amer"),
        };

        Assert.True(RequestService.CanDecide(Open(subject), "p-both", roles, people));
    }

    [Fact]
    public void Approving_completes_the_request()
    {
        var subject = Person("p-alice");
        var request = Open(subject);

        var outcome = RequestService.Decide(
            request, ApprovalDecisionKind.Approve, "p-approver", null, Now);

        Assert.True(outcome.IsFinalApproval);
        Assert.Equal(RequestState.Approved, request.State);
    }
}
