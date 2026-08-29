using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Auth;

/// <summary>One role, in one planning unit. <paramref name="UnitId"/> null is a global
/// grant — every unit for that role (ADR-0051).</summary>
public record RoleGrant(AppRole Role, string? UnitId);

/// <summary>
/// Who the caller is and what they may do.
///
/// <paramref name="Roles"/> is a list rather than one name because roles are a set and
/// each is scoped: somebody can plan AMER, approve EMEA and administer neither. A single
/// role name could not express that, and the ordinal it used to be compared against
/// implied a privilege ladder that does not exist.
///
/// <paramref name="StubMode"/> tells the client whether the dev identity switcher is
/// available. It is false in any real deployment, so the switcher has no way to appear
/// there.
/// </summary>
public record MeResponse(
    string? PersonId,
    string? DisplayName,
    IReadOnlyList<RoleGrant> Roles,
    bool StubMode);
