using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Auth;

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
        app.MapGet("/api/auth/me", (ClaimsPrincipal user) => Results.Ok(new MeResponse(
            user.FindFirst("personId")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value,
            user.Identity?.Name,
            user.FindFirst(ClaimTypes.Role)?.Value)))
        .WithName("GetCurrentUser")
        .Produces<MeResponse>()
        .RequireAuthorization(AuthPolicies.ViewerOrAbove);
    }
}
