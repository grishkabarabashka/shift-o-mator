using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Schedule;

public record ScheduleResponse(
    IReadOnlyList<string> UnitIds,
    SchedulePlan Plan,
    IReadOnlyList<CoverageCell> Coverage,
    IReadOnlyList<Issue> Issues,
    IReadOnlyCollection<string> AcknowledgedIssueKeys,
    IReadOnlyList<DayConfigurationSummary> DayConfigurations,
    string? OverlaidDraftId,
    IReadOnlyList<PendingRequestSummary> PendingRequests);

/// <summary>
/// A request awaiting a decision, overlapping the window.
///
/// Deliberately outside <see cref="SchedulePlan"/>: the plan is what has been decided,
/// and a pending request is a proposal. It is carried on the same response so the grid
/// can mark the cells it covers without a second round trip, and it must never be
/// counted as an absence — nothing materializes until approval (ADR-0045).
/// </summary>
public record PendingRequestSummary(
    string Id,
    string TypeId,
    string TypeCode,
    string TypeLabel,
    RequestCategory Category,
    string SubjectPersonId,
    string SubjectDisplayName,
    DateOnly From,
    DateOnly To,
    DayPortion Portion,
    DateTimeOffset CreatedAt,
    bool CallerCanDecide);

/// <summary>The plan slice actually inside <c>from</c>–<c>to</c> — coverage/issues are
/// computed over the same window but can reference dates outside it (e.g. a comp day's
/// proposed date), so this isn't just "the same objects again".</summary>
public record SchedulePlan(
    IReadOnlyList<Assignment> Assignments,
    IReadOnlyList<Absence> Absences,
    IReadOnlyList<CompDayEntry> CompDays,
    /// <summary>Where people are working over this window (ADR-0043). Carried on the
    /// same response as the plan so the grid needs one round trip, not two — but it is
    /// not part of the plan: nothing here affects coverage or blocks a publish.</summary>
    IReadOnlyList<PresenceRecord> Presence);

/// <summary>Which day-configuration version actually applies to a given unit/date —
/// resolved server-side (<c>DayConfigurationResolver</c>) so the client never
/// re-implements effective-dating (ADR-0021).</summary>
public record DayConfigurationSummary(DateOnly Date, string UnitId, string DayConfigurationId, DayConfigKey Key, string? Label);
