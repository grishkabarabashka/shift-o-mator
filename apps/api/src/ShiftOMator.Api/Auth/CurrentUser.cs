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

    /// <summary>
    /// The email an Entra ID token carries, or <c>null</c>. Not verified against the roster —
    /// <see cref="ActorResolver"/> does that (ADR-0058).
    ///
    /// WHY three claim types: Entra ID puts the work email in <c>preferred_username</c> for
    /// most tenants, in <c>email</c> when the optional claim is configured, and in <c>upn</c>
    /// for federated accounts. Which one arrives depends on tenant configuration nobody here
    /// controls, so all three are read rather than one being assumed.
    /// </summary>
    public static string? EmailOrNull(this ClaimsPrincipal user) =>
        user.FindFirst("preferred_username")?.Value
        ?? user.FindFirst(ClaimTypes.Email)?.Value
        ?? user.FindFirst("email")?.Value
        ?? user.FindFirst(ClaimTypes.Upn)?.Value;

    /// <summary>
    /// The display name an Entra ID token carries, or <c>null</c>. Used exactly once — by
    /// the setup wizard's Bare preset, to create the first person without asking anybody
    /// to type it (ADR-0059). Not verified against anything: there is no roster yet for it
    /// to be verified against.
    /// </summary>
    public static string? DisplayNameOrNull(this ClaimsPrincipal user) =>
        user.FindFirst("name")?.Value ?? user.FindFirst(ClaimTypes.Name)?.Value;
}

/// <summary>
/// An authenticated principal that maps to no <c>Person</c>. Deliberately fatal rather
/// than silently substituted: a write attributed to nobody defeats the audit trail that
/// ADR-0032 made the only access control. Mapped to <c>403 PRINCIPAL_NOT_MAPPED</c>.
/// </summary>
public class UnmappedPrincipalException(string? claimedPersonId)
    : InvalidOperationException(
        // The claimed identifier is echoed back deliberately: outside Stub mode it is the
        // signed-in email, and a person who sees it can send it to whoever administers
        // their unit to be linked. Without it, "403" is the whole of what they can report
        // and an admin has to go looking in the directory first (ADR-0058).
        $"The authenticated principal ({claimedPersonId ?? "no identifying claim"}) maps to no person "
        + "in the roster. An administrator links it on Settings → People.")
{
    public string? ClaimedPersonId { get; } = claimedPersonId;
}
