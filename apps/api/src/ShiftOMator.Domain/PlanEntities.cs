namespace ShiftOMator.Domain;

public class TimeOverride
{
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public bool CrossesMidnight { get; set; }
}

/// <summary>
/// Exactly one assignment per (person, date) — hard invariant. On-call is an ordinary
/// shift code occupying the day, never layered on top of another (Docs/01).
///
/// <see cref="Date"/> is the local date of the shift in the *shift's* timezone — that
/// removes the ambiguity for a shift crossing midnight.
/// </summary>
public class Assignment
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public required DateOnly Date { get; set; }
    /// <summary>Denormalized from the person's unit at write time — the same reason
    /// RegionId used to be, now on the single rule axis (PlanningUnit).</summary>
    public required string UnitId { get; set; }

    public AssignmentContentKind ContentKind { get; set; }
    /// <summary>Set when ContentKind == Role.</summary>
    public string? ShiftId { get; set; }
    public TimeOverride? TimeOverride { get; set; }
    /// <summary>Set when ContentKind == Marker.</summary>
    public RosterMarker? Marker { get; set; }

    /// <summary>Non-working by the person's *location* calendar (ADR-0002), not the shift's.</summary>
    public bool IsWeekend { get; set; }
    public string? Note { get; set; }
    public AssignmentSource Source { get; set; }
    /// <summary>Optimistic-locking token.</summary>
    public int Version { get; set; }
    public required string CreatedBy { get; set; }
    public required DateTimeOffset CreatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>The range is the source of truth; the grid cell is a projection (ADR-0017).</summary>
public class Absence
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public AbsenceType Type { get; set; }
    public required DateOnly From { get; set; }
    public required DateOnly To { get; set; }
    public AbsenceSource Source { get; set; }
    /// <summary>Which import produced this record — the actual rollback path is Undo
    /// on the client's draft (ADR-0028); this only marks provenance.</summary>
    public string? ImportBatchId { get; set; }
    /// <summary>Detects records that vanished from a later import.</summary>
    public DateTimeOffset? LastSeenInImportAt { get; set; }
    public DateTimeOffset? SyncedToHrAt { get; set; }
    public string? Note { get; set; }
}

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
}

/// <summary>Evaluates a plan, not part of it — an acknowledgement bypasses the draft
/// the same way a person-profile edit does (ADR-0009, ADR-0024).</summary>
public class Acknowledgement
{
    public int Id { get; set; }
    /// <summary>Stable across recomputations — matched by string key, not a foreign key.</summary>
    public required string IssueKey { get; set; }
    public required string Comment { get; set; }
    public required string ByPersonId { get; set; }
    public required DateTimeOffset At { get; set; }
}

/// <summary>Append-only audit of published changes.</summary>
public class AssignmentHistoryEntry
{
    public required string Id { get; set; }
    public required string AssignmentId { get; set; }
    public HistoryAction Action { get; set; }
    /// <summary>Full snapshot at the time of the action; null for a delete.</summary>
    public string? SnapshotJson { get; set; }
    public required string ActorId { get; set; }
    public required DateTimeOffset At { get; set; }
}
