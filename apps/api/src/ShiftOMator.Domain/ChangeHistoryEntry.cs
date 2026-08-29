namespace ShiftOMator.Domain;

/// <summary>
/// What kind of record a <see cref="ChangeHistoryEntry"/> describes. Assignments were
/// the only audited entity until ADR-0041; the others were changed with no trace at all.
/// </summary>
public enum HistoryEntityType
{
    Assignment,
    Absence,
    CompDay,
    Presence,
    Person,
    Configuration,

    /// <summary>Who was granted what, where. "Who made them an approver" is the first
    /// question after a bad approval (ADR-0051).</summary>
    RoleAssignment,
}

/// <summary>
/// Append-only audit of every published change (ADR-0041, generalising ADR-0015).
///
/// WHY it covers more than assignments: ADR-0032 removed unit-scoped write permissions
/// on the explicit grounds that "the control is a complete audit trail". It was not
/// complete — raising a coverage minimum, editing someone's eligibility, approving leave
/// or deleting a location all left no record whatsoever. One table, one shape, every
/// entity.
/// </summary>
public class ChangeHistoryEntry
{
    public required string Id { get; set; }
    public HistoryEntityType EntityType { get; set; }
    public required string EntityId { get; set; }
    public HistoryAction Action { get; set; }

    /// <summary>Full snapshot at the time of the action; null for a delete.</summary>
    public string? SnapshotJson { get; set; }

    /// <summary>The person the record is *about*, when there is one — so "what happened
    /// to me" is an index seek rather than a scan that parses every snapshot.</summary>
    public string? PersonId { get; set; }

    /// <summary>
    /// Which dates the change affected: both ends equal for an assignment, the whole span
    /// for an absence or a presence block.
    ///
    /// WHY not derived from the snapshot: "what happened to this cell" is the question
    /// people actually ask — who moved it, and whether a request came in before or after —
    /// and answering it by parsing every snapshot is a scan. These two columns make it a
    /// range predicate.
    /// </summary>
    public DateOnly? AffectedFrom { get; set; }
    public DateOnly? AffectedTo { get; set; }

    /// <summary>Short human-readable description, for entity types whose snapshot is not
    /// worth rendering in a timeline (configuration changes especially).</summary>
    public string? Summary { get; set; }

    public required string ActorId { get; set; }
    public required DateTimeOffset At { get; set; }
}
