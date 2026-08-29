namespace ShiftOMator.Domain;

/// <summary>An accrual with a balance, not a calendar event (ADR-0007). No expiry —
/// aging is a computed flag, not a status.</summary>
public class CompDayEntry
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public required string EarnedForAssignmentId { get; set; }
    public required DateOnly EarnedForDate { get; set; }
    public CompDayTrigger Trigger { get; set; }
    /// <summary>Nearest free eligible date in the window.</summary>
    public DateOnly? ProposedDate { get; set; }
    /// <summary>Set after the planner moves it.</summary>
    public DateOnly? ActualDate { get; set; }
    public CompDayStatus Status { get; set; }
    public DateTimeOffset? SyncedToHrAt { get; set; }

    /// <summary>Optimistic-concurrency token (ADR-0043) — see <see cref="Absence.Version"/>.</summary>
    public int Version { get; set; } = 1;
}
