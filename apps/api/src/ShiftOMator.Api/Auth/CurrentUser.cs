using System.Security.Claims;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Claim-level access to the acting identity. The authoritative resolution — including
/// the check that the id names a real person — lives in <see cref="ActorResolver"/>;
/// this is only the raw read (ADR-0039).
/// </summary>
public static class CurrentUser
{
    public const string PersonIdClaim = "personId";

    /// <summary>The person id the token claims, or <c>null</c>. Not verified against the roster.</summary>
    public static string? PersonIdOrNull(this ClaimsPrincipal user) =>
        user.FindFirst(PersonIdClaim)?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
}

/// <summary>
/// An authenticated principal that maps to no <c>Person</c>. Deliberately fatal rather
/// than silently substituted: a write attributed to nobody defeats the audit trail that
/// ADR-0032 made the only access control. Mapped to <c>403 PRINCIPAL_NOT_MAPPED</c>.
/// </summary>
public class UnmappedPrincipalException(string? claimedPersonId)
    : InvalidOperationException(
        $"The authenticated principal ({claimedPersonId ?? "no personId claim"}) maps to no person.")
{
    public string? ClaimedPersonId { get; } = claimedPersonId;
}
