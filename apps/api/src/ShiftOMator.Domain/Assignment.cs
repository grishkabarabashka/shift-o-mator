namespace ShiftOMator.Domain;

/// <summary>Owned value object — has no identity of its own, only ever
/// meaningful attached to an <see cref="Assignment"/>.</summary>
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
