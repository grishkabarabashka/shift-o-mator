namespace ShiftOMator.Domain;

/// <summary>Small predicates on entities — mirrors the free functions in domain/types.ts.</summary>
public static class DomainHelpers
{
    public static bool IsWorkingAssignment(Assignment a) => a.ContentKind == AssignmentContentKind.Shift;

    public static string? AssignmentShiftId(Assignment a) => a.ContentKind == AssignmentContentKind.Shift ? a.ShiftId : null;

    /// <summary>The date a comp day actually blocks, once one exists.</summary>
    public static DateOnly? EffectiveCompDayDate(CompDayEntry e) => e.ActualDate ?? e.ProposedDate;

    /// <summary>PROPOSED, SCHEDULED or PENDING_APPROVAL — not yet resolved.</summary>
    public static bool CompDayIsOutstanding(CompDayEntry e) =>
        e.Status is CompDayStatus.Proposed or CompDayStatus.Scheduled or CompDayStatus.PendingApproval;

    /// <summary>Only SCHEDULED and TAKEN occupy the day — PROPOSED is a suggestion.</summary>
    public static bool CompDayBlocksAssignment(CompDayEntry e) =>
        e.Status is CompDayStatus.Scheduled or CompDayStatus.Taken;
}
