using ShiftOMator.Application.Requests;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

public class RequestServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    private static Person Person(string id, string? managerId = null, OrgCategory category = OrgCategory.Support) =>
        new()
        {
            Id = id,
            DisplayName = id,
            Initials = id[..2].ToUpperInvariant(),
            UnitId = "unit-amer",
            LocationId = "loc-chicago",
            OrgCategory = category,
            ManagerId = managerId,
            CalendarToken = $"tok-{id}",
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

    private static Request Open(Person subject, RequestType type) =>
        RequestService.Open(type, subject, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 9), null, null, subject.Id, Now);

    public class Opening
    {
        [Fact]
        public void A_new_request_is_submitted_not_draft()
        {
            // WHY: there is no "save as draft" step in the UI — raising a request *is*
            // submitting it. A Draft state that nothing produced would be dead.
            var request = Open(Person("p-alice"), Type());

            Assert.Equal(RequestState.Submitted, request.State);
        }

        [Fact]
        public void An_inverted_range_is_refused()
        {
            var ex = Assert.Throws<RequestService.RequestDomainException>(() =>
                RequestService.Open(
                    Type(), Person("p-alice"), new DateOnly(2026, 9, 9), new DateOnly(2026, 9, 7),
                    null, null, "p-alice", Now));

            Assert.Equal("INVALID_RANGE", ex.Code);
        }

        [Fact]
        public void A_retired_request_type_cannot_be_raised()
        {
            var type = Type();
            type.IsActive = false;

            var ex = Assert.Throws<RequestService.RequestDomainException>(() =>
                RequestService.Open(
                    type, Person("p-alice"), new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 9),
                    null, null, "p-alice", Now));

            Assert.Equal("REQUEST_TYPE_INACTIVE", ex.Code);
        }
    }

    public class Decisions
    {
        [Fact]
        public void One_approval_settles_the_request()
        {
            // There is no second step to advance to any more: a single list of equal
            // approvers means the first decision is the decision (ADR-0051).
            var request = Open(Person("p-alice"), Type());

            var outcome = RequestService.Decide(
                request, ApprovalDecisionKind.Approve, "p-approver", "fine", Now);

            Assert.True(outcome.IsFinalApproval);
            Assert.Equal(RequestState.Approved, request.State);
            Assert.Equal(Now, request.DecidedAt);
            Assert.Single(request.Decisions);
        }

        [Fact]
        public void A_rejection_ends_the_request()
        {
            var request = Open(Person("p-alice"), Type());

            RequestService.Decide(request, ApprovalDecisionKind.Reject, "p-approver", "no", Now);

            Assert.Equal(RequestState.Rejected, request.State);
            Assert.Equal("no", request.Decisions[0].Comment);
        }

        [Fact]
        public void Returning_sends_it_back_to_the_requester_without_losing_the_comment()
        {
            var request = Open(Person("p-alice"), Type());

            RequestService.Decide(
                request, ApprovalDecisionKind.Return, "p-approver", "pick other dates", Now);

            Assert.Equal(RequestState.Draft, request.State);
            Assert.Equal("pick other dates", request.Decisions[0].Comment);
        }

        [Fact]
        public void A_decided_request_cannot_be_decided_again()
        {
            var request = Open(Person("p-alice"), Type());
            RequestService.Decide(request, ApprovalDecisionKind.Approve, "p-approver", null, Now);

            var ex = Assert.Throws<RequestService.RequestDomainException>(() =>
                RequestService.Decide(request, ApprovalDecisionKind.Reject, "p-approver", null, Now));

            Assert.Equal("REQUEST_NOT_PENDING", ex.Code);
        }

        [Fact]
        public void Every_decision_is_kept_even_after_later_ones()
        {
            // The log is append-only: "who decided this and what did they say" has to
            // survive every later state change (ADR-0045). A returned request that comes
            // back and is then approved keeps both.
            var request = Open(Person("p-alice"), Type());

            RequestService.Decide(request, ApprovalDecisionKind.Return, "p-one", "not those dates", Now);
            request.State = RequestState.Submitted;   // the requester amends and resubmits
            RequestService.Decide(request, ApprovalDecisionKind.Approve, "p-two", "better", Now);

            Assert.Equal(2, request.Decisions.Count);
            Assert.Equal(["not those dates", "better"], request.Decisions.Select(d => d.Comment));
        }
    }

    public class Application
    {
        [Fact]
        public void A_successful_application_records_the_entity_it_created()
        {
            var request = Open(Person("p-alice"), Type());
            request.State = RequestState.Approved;

            RequestService.RecordApplication(request, "presence-1", null, Now);

            Assert.Equal(RequestState.Applied, request.State);
            Assert.Equal("presence-1", request.MaterializedEntityId);
            Assert.Null(request.FailureReason);
        }

        [Fact]
        public void A_failed_application_keeps_the_approval_and_records_why()
        {
            // WHY the two states are separate: the approver already decided. Reverting to
            // Submitted would silently un-approve a human decision, and nobody would know
            // the write never happened.
            var request = Open(Person("p-alice"), Type());
            request.State = RequestState.Approved;

            RequestService.RecordApplication(request, null, "Location no longer exists.", Now);

            Assert.Equal(RequestState.ApplyFailed, request.State);
            Assert.Equal("Location no longer exists.", request.FailureReason);
        }

        [Fact]
        public void An_applied_request_can_still_be_withdrawn()
        {
            var request = Open(Person("p-alice"), Type());
            RequestService.RecordApplication(request, "presence-1", null, Now);

            RequestService.Cancel(request, Now);

            Assert.Equal(RequestState.Cancelled, request.State);
        }

        [Fact]
        public void A_rejected_request_cannot_be_cancelled()
        {
            var request = Open(Person("p-alice"), Type());
            request.State = RequestState.Rejected;

            var ex = Assert.Throws<RequestService.RequestDomainException>(() =>
                RequestService.Cancel(request, Now));

            Assert.Equal("REQUEST_NOT_CANCELLABLE", ex.Code);
        }
    }
}
