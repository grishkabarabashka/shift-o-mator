using ShiftOMator.Domain;

namespace ShiftOMator.Application.Requests;

/// <summary>
/// The request/approval state machine (ADR-0045, ADR-0051).
///
/// Pure, like the other engines: it takes the current instant as a parameter, never
/// touches storage, and returns what should happen. The endpoint persists the result.
///
/// WHY there is no route table any more: whose inbox a request lands in is now one
/// question with one answer — the people holding <see cref="AppRole.Approver"/> in the
/// subject's planning unit. The ordered multi-step route it replaces expressed things
/// nobody had asked for (manager then HR), had no admin screen, and needed a skip-forward
/// rule to stop unresolvable steps stalling requests forever. One list cannot stall.
/// </summary>
public static class RequestService
{
    /// <summary>Domain refusal, mapped to a typed 400 by the endpoint.</summary>
    public sealed class RequestDomainException(string code, string message)
        : Exception(message)
    {
        public string Code { get; } = code;
    }

    public static Request Open(
        RequestType type, Person subject, DateOnly from, DateOnly to,
        string? payloadJson, string? note, string actorId, DateTimeOffset now,
        DayPortion portion = DayPortion.Full)
    {
        if (to < from) throw new RequestDomainException("INVALID_RANGE", "`to` is before `from`.");
        if (!type.IsActive)
            throw new RequestDomainException("REQUEST_TYPE_INACTIVE", $"Request type {type.Code} is no longer offered.");

        return new Request
        {
            Id = Guid.NewGuid().ToString("n"),
            TypeId = type.Id,
            SubjectPersonId = subject.Id,
            UnitId = subject.UnitId,
            From = from,
            To = to,
            Portion = portion,
            PayloadJson = payloadJson,
            Note = note,
            State = RequestState.Submitted,
            CreatedBy = actorId,
            CreatedAt = now,
            Version = 1,
        };
    }

    /// <summary>
    /// Whose inbox this request is in: the approvers of the subject's unit.
    ///
    /// A global grant (<see cref="RoleAssignment.UnitId"/> null) counts for every unit.
    ///
    /// WHY the admin fallback: a unit with no approver configured would otherwise send
    /// every request to nobody, and nobody notices an empty inbox. Falling back to the
    /// people who can *fix* the configuration is the only destination that leads
    /// anywhere. It is a routing decision, not a privilege one — see
    /// <see cref="CanDecide"/>, which honours the same fallback so the two cannot
    /// disagree about who is looking at it.
    /// </summary>
    public static IReadOnlyList<string> ApproversFor(
        Request request,
        IReadOnlyList<RoleAssignment> roles,
        IReadOnlyList<Person> people)
    {
        var active = people.Where(p => p.IsActive).Select(p => p.Id).ToHashSet();

        var approvers = roles
            .Where(r => r.Role == AppRole.Approver && (r.UnitId is null || r.UnitId == request.UnitId))
            .Select(r => r.PersonId)
            .Where(active.Contains)
            .Distinct()
            .ToList();

        if (approvers.Count > 0) return approvers;

        return roles
            .Where(r => r.Role == AppRole.Admin)
            .Select(r => r.PersonId)
            .Where(active.Contains)
            .Distinct()
            .ToList();
    }

    /// <summary>Whether this person may decide this request.</summary>
    public static bool CanDecide(
        Request request,
        string personId,
        IReadOnlyList<RoleAssignment> roles,
        IReadOnlyList<Person> people) =>
        ApproversFor(request, roles, people).Contains(personId);

    /// <summary>True when the request reached the admin fallback — surfaced so a unit
    /// missing its approvers is visible rather than merely slow.</summary>
    public static bool IsUnrouted(Request request, IReadOnlyList<RoleAssignment> roles) =>
        !roles.Any(r => r.Role == AppRole.Approver && (r.UnitId is null || r.UnitId == request.UnitId));

    /// <summary>What a decision did, so the caller knows whether to materialize.</summary>
    public sealed record DecisionOutcome(RequestState State, bool IsFinalApproval);

    /// <summary>
    /// Records one approver's act. The first decision settles the request — with a single
    /// list of equal approvers there is nothing for a second one to add.
    /// </summary>
    public static DecisionOutcome Decide(
        Request request,
        ApprovalDecisionKind decision,
        string byPersonId,
        string? comment,
        DateTimeOffset now)
    {
        if (request.State != RequestState.Submitted)
        {
            throw new RequestDomainException("REQUEST_NOT_PENDING",
                $"This request is {request.State}, not awaiting a decision.");
        }

        request.Decisions.Add(new ApprovalDecision
        {
            Id = Guid.NewGuid().ToString("n"),
            RequestId = request.Id,
            Decision = decision,
            ByPersonId = byPersonId,
            Comment = comment,
            At = now,
        });
        request.UpdatedAt = now;
        request.Version += 1;

        switch (decision)
        {
            case ApprovalDecisionKind.Reject:
                request.State = RequestState.Rejected;
                request.DecidedAt = now;
                return new DecisionOutcome(request.State, false);

            case ApprovalDecisionKind.Return:
                // Back to the requester to amend. Deliberately not `Draft` in spirit: the
                // request stays visible to everyone who has seen it, with the returning
                // comment attached.
                request.State = RequestState.Draft;
                return new DecisionOutcome(request.State, false);

            default:
                request.State = RequestState.Approved;
                request.DecidedAt = now;
                return new DecisionOutcome(request.State, true);
        }
    }

    /// <summary>
    /// Cancels a request. Allowed before it takes effect, and after — withdrawing an
    /// approved-and-applied booking is a normal thing to want, and refusing it here would
    /// just move the work to a planner.
    /// </summary>
    public static void Cancel(Request request, DateTimeOffset now)
    {
        if (request.State is RequestState.Cancelled or RequestState.Rejected)
            throw new RequestDomainException("REQUEST_NOT_CANCELLABLE", $"This request is already {request.State}.");

        request.State = RequestState.Cancelled;
        request.UpdatedAt = now;
        request.Version += 1;
    }

    /// <summary>
    /// Cancels a request because a newer one replaced it, rather than because anybody
    /// withdrew it (ADR-0056). Only `Submitted` is touched — a request already decided is
    /// not a duplicate to clean up, it is a fact that happened, and `Cancel` would refuse
    /// a rejected one anyway. `Draft` (returned for the requester to amend) is left alone
    /// too: they are already mid-edit on it, and superseding it under them would discard
    /// work they have not abandoned.
    /// </summary>
    public static void Supersede(Request request, DateTimeOffset now)
    {
        if (request.State != RequestState.Submitted) return;
        request.State = RequestState.Cancelled;
        request.UpdatedAt = now;
        request.Version += 1;
    }

    /// <summary>Marks a request as having taken effect, or as having failed to.</summary>
    public static void RecordApplication(
        Request request, string? materializedEntityId, string? failureReason, DateTimeOffset now)
    {
        request.State = failureReason is null ? RequestState.Applied : RequestState.ApplyFailed;
        request.MaterializedEntityId = materializedEntityId;
        request.FailureReason = failureReason;
        request.UpdatedAt = now;
        request.Version += 1;
    }
}
