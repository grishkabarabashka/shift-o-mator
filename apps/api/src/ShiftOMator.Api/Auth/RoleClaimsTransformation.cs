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
/// Entra ID app roles are read too, and are **added to** the stored grants rather than
/// replacing them — holding two roles grants both, which is already how the model works
/// (ADR-0051). They can only ever be *global* grants (<c>unitId: null</c>), because the
/// directory has no unit to scope them to; per-unit access stays a database concern
/// (ADR-0058).
///
/// Everyone authenticated is a Viewer. It is not stored, because a row per person saying
/// "may read the rota" is a row that can only ever be wrong — and it is also the answer
/// for somebody who signs in successfully but is in no list at all: they read, nothing more.
/// </summary>
public class RoleClaimsTransformation(IServiceScopeFactory scopes) : IClaimsTransformation
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
        if (principal.FindFirst(StubAuthenticationHandler.OverrideRolesClaim) is { } over)
        {
            foreach (var name in over.Value.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                if (Enum.TryParse<AppRole>(name.Trim(), ignoreCase: true, out var role))
                    identity.AddClaim(Capabilities.ClaimFor(role, null));
            }

            return principal;
        }

        // Entra ID app roles arrive as `roles` claims. Anything that isn't one of ours is
        // ignored rather than rejected: a directory may assign roles for other apps to the
        // same account, and that is not this app's business.
        //
        // Materialized before the loop, and that is load-bearing: `FindAll` is a lazy view
        // over the identity's own claim collection, so adding to it while enumerating
        // throws "Collection was modified" — a 500 on every request from anybody who holds
        // an app role, and only from them.
        var appRoles = principal.FindAll("roles").ToList();
        foreach (var claim in appRoles)
        {
            if (Enum.TryParse<AppRole>(claim.Value.Trim(), ignoreCase: true, out var appRole))
                identity.AddClaim(Capabilities.ClaimFor(appRole, null));
        }

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();

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
                .RequireAsync(principal);
        }
        catch (UnmappedPrincipalException)
        {
            // Authenticated but mapping to nobody: Viewer and nothing else. The write paths
            // refuse it separately and loudly (ADR-0039).
            return principal;
        }

        var grants = await db.RoleAssignments.AsNoTracking()
            .Where(r => r.PersonId == personId)
            .Select(r => new { r.Role, r.UnitId })
            .ToListAsync();

        foreach (var grant in grants)
            identity.AddClaim(Capabilities.ClaimFor(grant.Role, grant.UnitId));

        return principal;
    }
}
