using System.Security.Claims;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Acting as somebody else (ADR-0069).
///
/// A lens makes the subject the **actor**: their roles, their rows, their writes. That is
/// the whole point — an administrator answering "why can you not book that day" has to be
/// able to try it, and a read-only lens can only ever show that the button is there.
///
/// What it does not do is lose the administrator. Every audit row written under a lens
/// carries <see cref="ChangeHistoryEntry.ImpersonatedById"/>, so ADR-0032's claim that the
/// audit trail *is* the access control survives: the trail names both the person the change
/// belongs to and the person who made it.
///
/// WHY the subject travels as a claim rather than a scoped service:
/// <see cref="RoleClaimsTransformation"/> resolves it, and that runs inside a scope it
/// creates for itself — a scoped service written there is a different instance from the one
/// an endpoint would resolve. The principal is the one thing that does flow.
/// </summary>
public static class Impersonation
{
    /// <summary>Read in every auth mode, unlike the <c>X-Debug-*</c> pair: this is a
    /// product feature with a server-side permission check, not a dev convenience.</summary>
    public const string Header = "X-Impersonate-PersonId";

    /// <summary>The subject, stamped only after the permission check passed. Once it is
    /// here, <see cref="ActorResolver.RequireAsync"/> answers with it.</summary>
    public const string SubjectClaim = "sfm:impersonating";

    /// <summary>The administrator behind the lens. Never the actor, and never consulted for
    /// a permission — the check already happened, at the moment this was stamped.</summary>
    public const string ImpersonatorClaim = "sfm:impersonated-by";

    /// <summary>Stamped when the header named somebody this caller may not act as.
    /// <see cref="ImpersonationGuard"/> turns it into a 403 — a silent denial would leave
    /// the administrator reading their *own* rows believing they were somebody else's.</summary>
    public const string DeniedClaim = "sfm:impersonation-denied";

    /// <summary>The person being acted as, or <c>null</c>.</summary>
    public static string? SubjectOrNull(this ClaimsPrincipal user) =>
        user.FindFirst(SubjectClaim)?.Value;

    /// <summary>The administrator behind the lens, or <c>null</c>.</summary>
    public static string? ImpersonatorOrNull(this ClaimsPrincipal user) =>
        user.FindFirst(ImpersonatorClaim)?.Value;

    /// <summary>One grant, as the transformation holds them before they become claims.</summary>
    public readonly record struct Grant(AppRole Role, string? UnitId);

    /// <summary>
    /// Holds this role over this unit. The claim-free twin of <see cref="Capabilities.Has"/>,
    /// because the permission to open a lens has to be checked against the caller's **own**
    /// grants at a point where the principal is still carrying nobody's.
    /// </summary>
    public static bool Holds(this IEnumerable<Grant> grants, AppRole role, string? unitId) =>
        grants.Any(g => g.Role == role && (g.UnitId is null || (unitId is not null && g.UnitId == unitId)));

    /// <summary>
    /// May a caller holding <paramref name="callerGrants"/> act as somebody in
    /// <paramref name="subjectUnitId"/> who holds <paramref name="subjectGrants"/>?
    ///
    /// Two conditions, and the second one exists because of what a lens now *is*.
    ///
    /// **Admin over the subject's unit**, scoped the way every grant is (ADR-0051). The
    /// argument for allowing this at all is that an administrator of a unit can already
    /// grant themselves any role in it on Settings → Roles, so acting as somebody in that
    /// unit hands them nothing they could not take in one click — and that argument stops
    /// exactly at the unit boundary, which is where the scope stops.
    ///
    /// **And the subject holds no global grant the caller lacks.** Without this, a unit
    /// Admin could act as whoever holds the global Admin grant — who may well sit in their
    /// own unit — and come out the other side administering every unit. That is the one
    /// escalation the first condition does not cover, because it crosses the very boundary
    /// the argument above depends on.
    /// </summary>
    public static bool MayImpersonate(
        IReadOnlyList<Grant> callerGrants,
        IReadOnlyList<Grant> subjectGrants,
        string? subjectUnitId)
    {
        if (!callerGrants.Holds(AppRole.Admin, subjectUnitId)) return false;

        foreach (var grant in subjectGrants)
        {
            // Only *global* grants are checked. A unit-scoped one is inside the unit this
            // caller already administers, which is the whole premise.
            if (grant.UnitId is null && !callerGrants.Holds(grant.Role, null)) return false;
        }

        return true;
    }
}

/// <summary>
/// The one thing a lens does **not** carry over (ADR-0069).
///
/// A lens lets an administrator do what the subject could do, because that is what makes it
/// worth having. The calendar feed address is the exception, and not for tidiness: the token
/// in that URL is the entire authentication on the only anonymous route in the product, it
/// outlives the lens, and the subject has no way to see that a copy was taken. Resetting it
/// is worse — it silently breaks whatever they have subscribed in Outlook.
///
/// Handing over a credential is not the same kind of act as making a change, which is why
/// this is a single refusal rather than a category.
/// </summary>
public static class CalendarFeedUnderLens
{
    /// <summary>Null when there is no lens, a 403 when there is.</summary>
    public static IResult? Refuse(this ClaimsPrincipal user, string what)
    {
        if (user.SubjectOrNull() is null) return null;

        return Results.Json(
            new Contracts.Shared.ErrorResponse("IMPERSONATION_READ_ONLY",
                $"{what} is the one thing acting as somebody else does not cover: the address "
                + "is a standing credential that outlives this session and that they cannot "
                + "see was taken. Stop acting as them first."),
            statusCode: StatusCodes.Status403Forbidden);
    }
}
