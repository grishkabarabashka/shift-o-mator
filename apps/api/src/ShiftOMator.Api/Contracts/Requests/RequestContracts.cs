using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Requests;

/// <summary>
/// Raising a request. The subject defaults to the caller; a planner may name someone
/// else, which <see cref="Auth.SelfOrPlanner"/> gates. Who actually raised it is taken
/// from the token (ADR-0039).
/// </summary>
public record CreateRequestRequest(
    string TypeId,
    DateOnly From,
    DateOnly To,
    string? SubjectPersonId = null,
    /// <summary>For a comp-day placement: which accrual is being placed (ADR-0052).</summary>
    string? CompDayId = null,
    string? Note = null,
    string? SiteLocationId = null,
    string? SiteLabel = null,
    DayPortion Portion = DayPortion.Full);

/// <summary>One approver's act. The decider is the authenticated caller.</summary>
public record DecideRequestRequest(ApprovalDecisionKind Decision, string? Comment = null);

/// <summary>
/// A request with the bits a screen needs that are not on the row: who it is about, who
/// is being waited on, and whether this caller is one of them.
/// </summary>
public record RequestView(
    Request Request,
    string TypeCode,
    string TypeLabel,
    string SubjectDisplayName,
    IReadOnlyList<string> PendingApproverIds,
    bool CallerCanDecide);

public record RequestListResponse(IReadOnlyList<RequestView> Requests);

public record NotificationListResponse(IReadOnlyList<Notification> Notifications, int UnreadCount);
