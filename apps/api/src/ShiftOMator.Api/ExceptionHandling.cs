using Microsoft.AspNetCore.Diagnostics;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Application.Drafts;

namespace ShiftOMator.Api;

/// <summary>
/// The single terminal handler for anything an endpoint did not catch itself.
///
/// WHY: before this, an unexpected exception produced the developer page locally and a
/// bare 500 with an empty body in any other environment — the client's
/// <c>ApiError</c> then had nothing to show the planner beyond "500". Every failure now
/// carries the same <see cref="ErrorResponse"/> shape the hand-caught ones already use,
/// plus the correlation id from <see cref="RequestCorrelationMiddleware"/> so a report
/// of "it failed" can be matched to a log line.
/// </summary>
public static class ExceptionHandling
{
    public static Action<IApplicationBuilder> Handler => builder => builder.Run(async context =>
    {
        var feature = context.Features.Get<IExceptionHandlerFeature>();
        var error = feature?.Error;

        var (status, code, message) = error switch
        {
            UnmappedPrincipalException ex => (
                StatusCodes.Status403Forbidden,
                "PRINCIPAL_NOT_MAPPED",
                ex.Message),
            DraftDomainException ex => (
                StatusCodes.Status400BadRequest,
                ex.Code,
                ex.Message),
            BadHttpRequestException ex => (
                StatusCodes.Status400BadRequest,
                "MALFORMED_REQUEST",
                ex.Message),
            OperationCanceledException => (
                StatusCodes.Status499ClientClosedRequest,
                "CLIENT_CLOSED_REQUEST",
                "The client cancelled the request."),
            _ => (
                StatusCodes.Status500InternalServerError,
                "INTERNAL_ERROR",
                // Deliberately generic: the detail is in the log line the correlation id
                // points at, not in a body that reaches the browser.
                "The request failed. Quote the correlation id when reporting this."),
        };

        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("ShiftOMator.Api.UnhandledException");
        if (status >= 500)
            logger.LogError(error, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
        else
            logger.LogWarning(error, "Request refused ({Code}) for {Method} {Path}", code, context.Request.Method, context.Request.Path);

        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new ErrorResponse(code, message));
    });
}

/// <summary>
/// Stamps every request with a correlation id (echoed as <c>X-Correlation-Id</c>) and
/// opens a logging scope around it.
///
/// WHY: with self-service, "I submitted that on the 3rd" becomes a question someone has
/// to answer from logs. Without a per-request id there is nothing to search by.
/// </summary>
public class RequestCorrelationMiddleware(RequestDelegate next, ILogger<RequestCorrelationMiddleware> logger)
{
    public const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers.TryGetValue(HeaderName, out var supplied)
            && !string.IsNullOrWhiteSpace(supplied)
                ? supplied.ToString()
                : context.TraceIdentifier;

        context.Response.Headers[HeaderName] = correlationId;

        using (logger.BeginScope(new Dictionary<string, object?>
        {
            ["CorrelationId"] = correlationId,
            ["PersonId"] = context.User.PersonIdOrNull(),
        }))
        {
            await next(context);
        }
    }
}
