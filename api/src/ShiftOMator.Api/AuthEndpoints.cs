using System.Security.Claims;
using ShiftOMator.Api.Auth;

namespace ShiftOMator.Api;

/// <summary>
/// Reads whatever <see cref="ClaimsPrincipal"/> the active auth scheme produced —
/// <see cref="Auth.StubAuthenticationHandler"/> today, real JWT bearer once
/// <c>Auth:Mode</c> is switched — so this endpoint's shape never changes across that
/// swap, only the identity behind it.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/me", (ClaimsPrincipal user) => Results.Ok(new
        {
            personId = user.FindFirst("personId")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value,
            displayName = user.Identity?.Name,
            role = user.FindFirst(ClaimTypes.Role)?.Value,
        }))
        .WithName("GetCurrentUser")
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
