using ShiftOMator.Api.Contracts.Shared;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Refuses a request whose <c>X-Impersonate-PersonId</c> the caller may not act as
/// (ADR-0069).
///
/// WHY a refusal and not a silent fall-back to the caller's own identity: the client sends
/// the header on *every* request while a lens is open and renders the result as the
/// subject's. Dropping it quietly would show an administrator their own calendar, their own
/// inbox and their own comp-day balance under somebody else's name — the one failure mode
/// where being wrong is invisible. A 403 is a banner the client can act on.
///
/// Sits after authentication, because the claim it looks for is stamped by
/// <see cref="RoleClaimsTransformation"/>, which the authentication middleware runs.
/// </summary>
public sealed class ImpersonationGuard(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var requested = context.Request.Headers[Impersonation.Header].ToString().Trim();

        if (!string.IsNullOrEmpty(requested)
            && context.User.Identity?.IsAuthenticated == true
            && context.User.FindFirst(Impersonation.DeniedClaim) is not null)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new ErrorResponse(
                "IMPERSONATION_FORBIDDEN",
                $"You may not view the application as {requested}. "
                + "Administering the planning unit that person belongs to is what it takes."));
            return;
        }

        await next(context);
    }
}
