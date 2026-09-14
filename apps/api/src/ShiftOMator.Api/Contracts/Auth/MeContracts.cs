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
///
/// <paramref name="PersonId"/> and <paramref name="Roles"/> describe the **subject** while
/// an impersonation lens is open, which is the whole point of the lens: the client renders
/// the screen that person sees. <paramref name="ImpersonatedBy"/> is who is really at the
/// keyboard, and is what every write is still attributed to (ADR-0069). A client that only
/// reads the first two fields is not wrong about what to draw, only about who to warn.
/// </summary>
public record MeResponse(
    string? PersonId,
    string? DisplayName,
    IReadOnlyList<RoleGrant> Roles,
    bool StubMode,
    ImpersonatorSummary? ImpersonatedBy = null,
    bool CanImpersonate = false);

/// <summary>The administrator behind an open lens — never the subject.</summary>
public record ImpersonatorSummary(string PersonId, string DisplayName);

/// <summary>Start viewing as somebody. The subject is a person id, not an email: the
/// caller picked them from the roster the client already holds.</summary>
public record StartImpersonationRequest(string PersonId);
