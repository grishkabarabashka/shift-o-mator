using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Absences;

/// <summary>
/// Recording time off. <c>PersonId</c> is part of the payload because a planner may record
/// it on someone else's behalf; who is *allowed* to is decided by
/// <see cref="Auth.Capabilities.CanWriteRecordOf"/>, and who actually did is taken from
/// the token (ADR-0039).
///
/// Whether it may be recorded at all, or has to be asked for, is decided by the
/// <see cref="EventType"/>'s <c>RequiresApproval</c> — not by the caller's role
/// (ADR-0051). The endpoint refuses a direct write of an approval-needing type rather
/// than silently letting a planner skip the step.
///
/// <c>Version</c> is the token of the record being replaced, omitted when creating.
/// </summary>
public record UpsertAbsenceRequest(
    string PersonId,
    string EventTypeId,
    DateOnly From,
    DateOnly To,
    DayPortion Portion = DayPortion.Full,
    string? Note = null,
    int? Version = null);

public record AbsenceListResponse(IReadOnlyList<Absence> Absences);
