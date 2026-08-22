using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Schedule;

public record ScheduleResponse(
    IReadOnlyList<string> UnitIds,
    SchedulePlan Plan,
    IReadOnlyList<CoverageCell> Coverage,
    IReadOnlyList<Issue> Issues,
    IReadOnlyCollection<string> AcknowledgedIssueKeys,
    IReadOnlyList<DayConfigurationSummary> DayConfigurations,
    string? OverlaidDraftId);

/// <summary>The plan slice actually inside <c>from</c>–<c>to</c> — coverage/issues are
/// computed over the same window but can reference dates outside it (e.g. a comp day's
/// proposed date), so this isn't just "the same objects again".</summary>
public record SchedulePlan(
    IReadOnlyList<Assignment> Assignments,
    IReadOnlyList<Absence> Absences,
    IReadOnlyList<CompDayEntry> CompDays);

/// <summary>Which day-configuration version actually applies to a given unit/date —
/// resolved server-side (<c>DayConfigurationResolver</c>) so the client never
/// re-implements effective-dating (ADR-0021).</summary>
public record DayConfigurationSummary(DateOnly Date, string UnitId, string DayConfigurationId, DayConfigKey Key, string? Label);
