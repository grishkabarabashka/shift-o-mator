using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Turns the person the token names into the roles they hold (ADR-0051).
///
/// WHY the *scoped* grants come from the database and not from the token: they are scoped
/// to planning units, and a planning unit is this product's own concept — an identity
/// provider has no idea what <c>unit-emea</c> is and no reason to learn. The token
/// establishes *who you are*; what you may do in a given unit is data an admin edits on a
/// Settings screen and which takes effect on the next request, not on the next token
/// refresh.
///
/// Entra ID app roles can be read too, and are then **added to** the stored grants rather
/// than replacing them — holding two roles grants both, which is already how the model
/// works (ADR-0051). They can only ever be *global* grants (<c>unitId: null</c>), because
/// the directory has no unit to scope them to; per-unit access stays a database concern
/// (ADR-0058).
///
/// That reading is **off unless <c>SystemSetup.DirectoryRoles</c> says otherwise**
/// (ADR-0062; moved out of configuration and into a row by ADR-0063).
/// A directory grant does not appear on Settings → Roles and cannot be revoked there, so
/// leaving it on by default made the one screen that answers "who can do what" tell half
/// the truth. See <see cref="ShiftOMator.Domain.SystemSetup.DirectoryRoles"/> for the
/// full reasoning.
///
/// Everyone authenticated is a Viewer. It is not stored, because a row per person saying
/// "may read the rota" is a row that can only ever be wrong — and it is also the answer
/// for somebody who signs in successfully but is in no list at all: they read, nothing more.
/// </summary>
public class RoleClaimsTransformation(IServiceScopeFactory scopes, IHttpContextAccessor http) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        // Already transformed: ASP.NET Core may run this more than once per request, and
        // appending the same grants twice would be harmless but wasteful.
        if (principal.HasClaim(claim => claim.Type == Capabilities.RoleClaim)) return principal;

        var identity = principal.Identity as ClaimsIdentity ?? new ClaimsIdentity();
        identity.AddClaim(Capabilities.ClaimFor(AppRole.Viewer, null));

        // A debug override replaces the stored grants entirely rather than adding to them,
        // so "what does a plain Viewer see" is actually testable on an account that is a
        // Planner in real life. Stub mode only — the header is read nowhere else.
        //
        // Checked before the person id, not after: the stub can be configured with a role
        // and no person at all, and letting ActorResolver pick the person is the whole
        // point of that mode.
        //
        // WHY it no longer returns early: an impersonation lens has to be resolved even
        // under an override, and the test factory pins `Auth:StubRole` for every request it
        // makes — so returning here made the lens untestable and, worse, made it silently do
        // nothing in any deployment that had ever set that setting (ADR-0069).
        var over = principal.FindFirst(StubAuthenticationHandler.OverrideRolesClaim);
        var overridden = over is not null;
        if (over is not null)
        {
            foreach (var name in over.Value.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                if (Enum.TryParse<AppRole>(name.Trim(), ignoreCase: true, out var role))
                    identity.AddClaim(Capabilities.ClaimFor(role, null));
            }
        }

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ShiftOMatorDbContext>();

        // Entra ID app roles arrive as `roles` claims. Anything that isn't one of ours is
        // ignored rather than rejected: a directory may assign roles for other apps to the
        // same account, and that is not this app's business.
        //
        // Read only when the system asks for them: what the directory grants is invisible
        // to Settings → Roles, and a permission nobody can see on the screen that lists
        // permissions is worse than a permission nobody has (ADR-0062). The switch is a
        // row rather than a setting (ADR-0063), so this is one more read on the scope just
        // opened — and it belongs here rather than cached at startup, because the toggle
        // takes effect on the next request exactly like the grants beside it.
        //
        // Sits before the actor is resolved, deliberately: an app role is granted by the
        // token, so somebody who holds one but maps to no `Person` still holds it.
        if (!overridden
            && await db.SystemSetups.AsNoTracking().Select(x => x.DirectoryRoles).FirstOrDefaultAsync())
        {
            // Materialized before the loop, and that is load-bearing: `FindAll` is a lazy
            // view over the identity's own claim collection, so adding to it while
            // enumerating throws "Collection was modified" — a 500 on every request from
            // anybody who holds an app role, and only from them.
            foreach (var claim in principal.FindAll("roles").ToList())
            {
                if (Enum.TryParse<AppRole>(claim.Value.Trim(), ignoreCase: true, out var appRole))
                    identity.AddClaim(Capabilities.ClaimFor(appRole, null));
            }
        }

        // WHY the actor is resolved here rather than read straight off the claim: in stub
        // mode with no pinned person the token carries no person id at all, and
        // `ActorResolver` substitutes a real one. Reading the claim meant the *default*
        // identity — what you get on opening the app without touching the switcher — was
        // resolved to a real person for every write and yet had no grants: Settings never
        // appeared and no Approve button rendered, for the one identity most testing uses.
        //
        // The two answers have to agree. They now come from the same place.
        string personId;
        try
        {
            personId = await scope.ServiceProvider.GetRequiredService<ActorResolver>()
                .RequireRealActorAsync(principal);
        }
        catch (UnmappedPrincipalException)
        {
            // Authenticated but mapping to nobody: Viewer and nothing else. The write paths
            // refuse it separately and loudly (ADR-0039).
            return principal;
        }

        // An override *replaces* the stored grants rather than adding to them, which is what
        // makes "what does a plain Viewer see" testable on an account that is a Planner.
        var own = overridden
            ? [.. identity.FindAll(Capabilities.RoleClaim).Select(ParseGrant)]
            : await GrantsOfAsync(db, personId);

        // Resolved before anything is stamped: a lens *replaces* the grants, and the check
        // that it may has to run against the caller's own — which by then would be gone.
        var lens = await ResolveLensAsync(db, personId, own);

        if (lens.Denied is not null)
        {
            identity.AddClaim(new Claim(Impersonation.DeniedClaim, lens.Denied));
        }
        else if (lens.SubjectId is not null)
        {
            identity.AddClaim(new Claim(Impersonation.SubjectClaim, lens.SubjectId));
            identity.AddClaim(new Claim(Impersonation.ImpersonatorClaim, personId));
        }

        if (lens.SubjectGrants is not null)
        {
            // Everything stamped so far belongs to the administrator — the baseline Viewer,
            // and any debug override. It is *removed*, not added to: a lens replaces who you
            // are, and a union would quietly make the caller more powerful than either
            // person, which is the one outcome this must never produce.
            foreach (var stale in identity.FindAll(Capabilities.RoleClaim).ToList())
                identity.RemoveClaim(stale);

            // The subject's grants, entire: acting as somebody means being able to do what
            // they could do, or the lens only ever proves that the button is where they said
            // it was (ADR-0069). The escalation this would otherwise open — acting as the
            // holder of a global grant you lack — is refused above, not trimmed here.
            foreach (var grant in lens.SubjectGrants)
                identity.AddClaim(Capabilities.ClaimFor(grant.Role, grant.UnitId));
        }
        else if (!overridden)
        {
            foreach (var grant in own)
                identity.AddClaim(Capabilities.ClaimFor(grant.Role, grant.UnitId));
        }

        return principal;
    }

    private static Impersonation.Grant ParseGrant(Claim claim)
    {
        var parts = claim.Value.Split('|', 2);
        return new Impersonation.Grant(
            Enum.Parse<AppRole>(parts[0], ignoreCase: true),
            parts.Length == 2 && parts[1].Length > 0 ? parts[1] : null);
    }

    private static async Task<List<Impersonation.Grant>> GrantsOfAsync(
        ShiftOMatorDbContext db, string personId) =>
        [.. (await db.RoleAssignments.AsNoTracking()
                .Where(r => r.PersonId == personId)
                .Select(r => new { r.Role, r.UnitId })
                .ToListAsync())
            .Select(r => new Impersonation.Grant(r.Role, r.UnitId))];

    /// <summary>
    /// Resolves <c>X-Impersonate-PersonId</c> (ADR-0069): who is being acted as, what they
    /// hold, or why not.
    ///
    /// A denial is returned rather than thrown, and is stamped as a claim rather than
    /// silently dropped, because the client sends this header on every request while a lens
    /// is open. Quietly ignoring it would show an administrator their own calendar, own
    /// inbox and own balances under somebody else's name — wrong in a way nothing on screen
    /// would reveal. <see cref="ImpersonationGuard"/> turns the claim into a 403.
    /// </summary>
    private async Task<(string? SubjectId, List<Impersonation.Grant>? SubjectGrants, string? Denied)>
        ResolveLensAsync(ShiftOMatorDbContext db, string actorId, IReadOnlyList<Impersonation.Grant> own)
    {
        var requested = http.HttpContext?.Request.Headers[Impersonation.Header].ToString().Trim();
        if (string.IsNullOrEmpty(requested)) return (null, null, null);

        // Acting as yourself is the absence of a lens, not a denial: the client clears the
        // header on exit, and a race that leaves it set for one request should not 403.
        if (requested == actorId) return (null, null, null);

        var subject = await db.People.AsNoTracking()
            .Where(p => p.Id == requested)
            .Select(p => new { p.Id, p.UnitId })
            .FirstOrDefaultAsync();

        // An inactive person is deliberately still reachable: "why does this leaver still
        // show on the rota" is a question asked after the account is switched off.
        if (subject is null) return (null, null, requested);

        var subjectGrants = await GrantsOfAsync(db, subject.Id);
        if (!Impersonation.MayImpersonate(own, subjectGrants, subject.UnitId))
            return (null, null, requested);

        // Viewer is granted to everyone signed in and is not stored, so it has to be added
        // back here — otherwise acting as an engineer produces somebody with no roles at all.
        subjectGrants.Add(new Impersonation.Grant(AppRole.Viewer, null));

        return (subject.Id, subjectGrants, null);
    }

}
