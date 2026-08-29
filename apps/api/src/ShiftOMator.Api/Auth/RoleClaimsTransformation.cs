using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Turns the person the token names into the roles they hold (ADR-0051).
///
/// WHY the grants come from the database and not from the token: they are scoped to
/// planning units, and a planning unit is this product's own concept — an identity
/// provider has no idea what <c>unit-emea</c> is and no reason to learn. The token
/// establishes *who you are*; what you may do is data an admin edits on a Settings screen
/// and which takes effect on the next request, not on the next token refresh.
///
/// Everyone authenticated is a Viewer. It is not stored, because a row per person saying
/// "may read the rota" is a row that can only ever be wrong.
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
