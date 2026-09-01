using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Setup;

namespace ShiftOMator.Api.Setup;

/// <summary>
/// Refuses everything except <c>/health/*</c> and <c>/api/setup/*</c> until a
/// <see cref="ShiftOMator.Domain.SystemSetup"/> row exists (ADR-0059).
///
/// WHY a middleware and not a check on every endpoint: the failure mode of the
/// alternative is a forgotten endpoint that accepts writes into an unconfigured system,
/// and that is exactly the kind of omission nobody notices until an audit trail names an
/// actor that was never supposed to be able to act.
///
/// WHY it runs before authentication rather than after: a blocked request needs no
/// identity to be told "not yet" — deferring the check would mean authenticating (and,
/// outside Stub mode, validating a bearer token) for every single request while the
/// system has nothing behind it to authenticate for.
/// </summary>
public class SetupGateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ScheduleDbContext db)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/health", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/setup", StringComparison.OrdinalIgnoreCase)
            // Documentation, not data: `npm run api:schema` fetches `/openapi/v1.json`
            // against a freshly migrated, not-yet-set-up database, and Scalar's "Try it"
            // is a dev convenience, not a write path that needs gating.
            || path.StartsWith("/openapi", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/scalar", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        if (await SetupService.IsRequiredAsync(db, context.RequestAborted))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsJsonAsync(
                new ErrorResponse("SETUP_REQUIRED", "This system has not been set up yet."));
            return;
        }

        await next(context);
    }
}
