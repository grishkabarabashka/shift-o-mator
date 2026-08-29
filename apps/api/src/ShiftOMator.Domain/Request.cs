namespace ShiftOMator.Domain;

/// <summary>What a request is broadly about. Used for grouping and filtering only —
/// behaviour comes from <see cref="RequestType"/>.</summary>
public enum RequestCategory
{
    Presence,
    Leave,
    Swap,
    CompDay,
    Other,
}

/// <summary>
/// What an approved request turns into. <see cref="None"/> means the approval is the
/// whole outcome — useful for types whose real effect lives in another system, and for
/// running the mechanism on real traffic before it owns anything.
/// </summary>
public enum RequestMaterializer
{
    None,
    Presence,
    Absence,

    /// <summary>Places an already-earned comp day on a chosen date (ADR-0052). It creates
    /// nothing: the accrual exists from the moment the weekend shift was published, and
    /// approval only settles *when* it is taken.</summary>
    CompDay,
}

/// <summary>
/// Request lifecycle.
///
/// WHY <see cref="Approved"/> and <see cref="Applied"/> are distinct states: approval is
/// a decision a human made, application is a write that can still fail a validity check.
/// Collapsing them would mean a rejected write silently un-approved a decision someone
/// had already taken, and the approver would never learn that nothing happened
/// (ADR-0045).
/// </summary>
public enum RequestState
{
    Draft,
    Submitted,
    Approved,
    Rejected,
    Cancelled,
    Applied,
    ApplyFailed,
}

public enum ApprovalDecisionKind
{
    Approve,
    Reject,
    Return,
}

/// <summary>
/// Configuration: what kinds of request exist, and what each one turns into.
///
/// WHY a generic envelope with a typed outcome (ADR-0045): a type-specific entity per
/// request kind would mean a deployment every time someone wants a new one, which is the
/// thing this feature exists to remove. A fully generic *store*, on the other hand,
/// would break every engine — coverage, validation and the cell projection all read
/// typed rows. So the envelope is generic and the result is not.
/// </summary>
public class RequestType
{
    public required string Id { get; set; }
    public required string Code { get; set; }
    public required string Label { get; set; }
    public RequestCategory Category { get; set; }
    public RequestMaterializer Materializer { get; set; }

    /// <summary>For <see cref="RequestMaterializer.Absence"/>: which event type an
    /// approval produces.</summary>
    public string? EventTypeId { get; set; }

    /// <summary>For <see cref="RequestMaterializer.Presence"/>: which presence kind an
    /// approval produces.</summary>
    public string? PresenceTypeId { get; set; }

    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

/// <summary>
/// One request, from anybody, about themselves.
///
/// <see cref="From"/>/<see cref="To"/> are hoisted out of the payload deliberately: the
/// inbox filters on them and the capacity check reads them, and neither should have to
/// parse JSON to do it.
/// </summary>
public class Request
{
    public required string Id { get; set; }
    public required string TypeId { get; set; }
    public required string SubjectPersonId { get; set; }

    /// <summary>Denormalized from the subject, like <see cref="Assignment.UnitId"/>, so
    /// an inbox scoped to a unit is one predicate.</summary>
    public required string UnitId { get; set; }

    public required DateOnly From { get; set; }
    public required DateOnly To { get; set; }

    /// <summary>Whole day, or one half of it (ADR-0050). Carried through to whatever the
    /// approval materializes.</summary>
    public DayPortion Portion { get; set; } = DayPortion.Full;

    /// <summary>Type-specific detail — which office, which shift to swap. Shape is
    /// decided by the type, validated at the endpoint.</summary>
    public string? PayloadJson { get; set; }

    public string? Note { get; set; }

    public RequestState State { get; set; }

    /// <summary>Why application failed, when <see cref="State"/> is
    /// <see cref="RequestState.ApplyFailed"/> — the approver's decision stands, so this
    /// is the only place the reason can live.</summary>
    public string? FailureReason { get; set; }

    public string? MaterializedEntityId { get; set; }

    public required string CreatedBy { get; set; }
    public required DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }

    public int Version { get; set; } = 1;

    public List<ApprovalDecision> Decisions { get; set; } = [];
}

/// <summary>Append-only: one row per human act. Never updated, so "who approved this and
/// what did they say" survives every later state change.</summary>
public class ApprovalDecision
{
    public required string Id { get; set; }
    public required string RequestId { get; set; }
    public ApprovalDecisionKind Decision { get; set; }
    public required string ByPersonId { get; set; }
    public string? Comment { get; set; }
    public required DateTimeOffset At { get; set; }
}
