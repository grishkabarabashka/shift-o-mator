namespace ShiftOMator.Domain;

/// <summary>The range is the source of truth; the grid cell is a projection (ADR-0017).</summary>
public class Absence
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    /// <summary>Which <see cref="EventType"/> this is — vacation, sick, furlough and
    /// anything else an admin has defined (ADR-0049).</summary>
    public required string EventTypeId { get; set; }

    /// <summary>Whole day, or one half of it. The assignment invariant is untouched:
    /// someone on leave in the morning and on a shift in the afternoon still holds
    /// exactly one assignment (ADR-0050).</summary>
    public DayPortion Portion { get; set; } = DayPortion.Full;
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

    /// <summary>
    /// Optimistic-concurrency token (ADR-0043). Absences used to have none, so publish
    /// detected a concurrent edit by reserialising the live row and comparing it to the
    /// draft's snapshot byte for byte — which reported a false conflict on any change to
    /// the serializer or the property order, and would miss a real one if two edits
    /// happened to produce identical JSON. Self-service makes absences a
    /// frequently-written entity, so they get the same token assignments already had.
    /// </summary>
    public int Version { get; set; } = 1;
}
