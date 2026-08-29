namespace ShiftOMator.Domain;

/// <summary>
/// A kind of non-working day, defined as data rather than as an enum member (ADR-0049).
///
/// WHY there is no `CountsAsCoverage` here, and never will be: **if it counts as
/// coverage it is a <see cref="Shift"/>.** That is ADR-0017's "training is the Cover
/// shift, not an absence" turned into a schema-level guarantee, and it is what keeps
/// <see cref="Application"/>'s coverage engine untouched by an admin adding a new type.
///
/// <see cref="AllowsHalfDay"/> is per type because some genuinely are whole-day only —
/// furlough is not taken in mornings.
/// </summary>
public class EventType
{
    public required string Id { get; set; }
    public required string Code { get; set; }
    public required string Label { get; set; }

    /// <summary>Short form for a grid cell — two to five characters.</summary>
    public required string ShortLabel { get; set; }

    public required string Color { get; set; }

    /// <summary>Grouping only; behaviour comes from the flags below.</summary>
    public EventCategory Category { get; set; }

    /// <summary>Whether a person holding this cannot also hold a shift that day. Vacation
    /// blocks; a floating holiday someone still worked does not.</summary>
    public bool BlocksAssignment { get; set; } = true;

    /// <summary>Whether it counts toward the simultaneous-absence limits (ADR-0010).
    /// A new type defaults to <b>not</b> counted — silently tightening every existing
    /// limit is the worse surprise.</summary>
    public bool CountsTowardCapacity { get; set; }

    /// <summary>
    /// Whether recording it needs somebody's approval first.
    ///
    /// A property of the **thing**, not of who is recording it (ADR-0051): a planner
    /// putting leave on somebody else's row raises a request like anybody else. Only
    /// where the approval goes was ever configurable, and that is now one answer — the
    /// approvers of the subject's unit.
    /// </summary>
    public bool RequiresApproval { get; set; } = true;

    public bool AllowsHalfDay { get; set; } = true;

    /// <summary>Retiring a type must not rewrite history, so it is deactivated rather
    /// than deleted; existing absences keep pointing at it.</summary>
    public bool IsActive { get; set; } = true;

    public int SortOrder { get; set; }
}

public enum EventCategory
{
    Leave,
    Sickness,
    Other,
}
