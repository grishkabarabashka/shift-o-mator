namespace ShiftOMator.Domain;

/// <summary>
/// One grant: this person holds this role, in this planning unit (ADR-0051).
///
/// WHY a table and not a field on <see cref="Person"/>: roles are additive and scoped,
/// so a person is a Planner in one unit, an Approver in another, and neither anywhere
/// else. A column would force one role per person and a second column the moment
/// somebody held two.
///
/// <see cref="UnitId"/> is null for a **global** grant. It exists for two real cases:
/// configuration that belongs to no unit (locations, holidays, the units themselves),
/// and the cross-unit planner who covers for everybody. A global grant satisfies every
/// unit-scoped check for that role — it is a superset in *scope*, never in privilege.
/// </summary>
public class RoleAssignment
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }

    /// <summary>Null means every unit, and configuration that belongs to none.</summary>
    public string? UnitId { get; set; }

    public required AppRole Role { get; set; }

    /// <summary>Who granted it and when — the grant is itself an auditable act, and
    /// "who made them an approver" is the first question after a bad approval.</summary>
    public required string GrantedBy { get; set; }
    public required DateTimeOffset GrantedAt { get; set; }
}
