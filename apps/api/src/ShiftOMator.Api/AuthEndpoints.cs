using System.Security.Claims;
using Microsoft.Extensions.Options;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Auth;
using ShiftOMator.Domain;

namespace ShiftOMator.Api;

/// <summary>
/// The client's identity, resolved the same way every write path resolves it
/// (<see cref="ActorResolver"/>, ADR-0039) — so "who am I" and "who will the audit trail
/// say I am" can never disagree. Before this, the client guessed its own identity by
/// picking the first manager in scope, and the two answers routinely differed.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/me", async (
            ClaimsPrincipal user, ActorResolver actors, IOptions<AuthOptions> auth, CancellationToken ct) =>
        {
            var person = await actors.RequirePersonAsync(user, ct);

            // The whole grant list, not one role name: roles are a set and each is scoped
            // to a unit, so "can I plan here" is a question only the client asking about a
            // specific row can answer (ADR-0051).
            var grants = user.FindAll(Capabilities.RoleClaim)
                .Select(claim => claim.Value.Split('|', 2))
                .Where(parts => parts.Length == 2 && Enum.TryParse<AppRole>(parts[0], true, out _))
                .Select(parts => new RoleGrant(
                    Enum.Parse<AppRole>(parts[0], ignoreCase: true),
                    parts[1].Length == 0 ? null : parts[1]))
                .ToList();

            return Results.Ok(new MeResponse(
                person?.Id,
                person?.DisplayName ?? user.Identity?.Name,
                grants,
                string.Equals(auth.Value.Mode, "Stub", StringComparison.OrdinalIgnoreCase)));
        })
        .WithName("GetCurrentUser")
        .Produces<MeResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);
    }
}
