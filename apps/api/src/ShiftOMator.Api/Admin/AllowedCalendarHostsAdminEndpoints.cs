using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// The holiday-import allowlist (ADR-0063 shape, see <c>AllowedCalendarHost</c>'s
/// remarks): which hosts <c>HolidayImportEndpoints</c> may fetch a calendar feed from.
///
/// Global Admin only, like the directory-roles switch: a host allowed here is reachable
/// for every unit's import, and there is no "this unit's hosts" to scope it to — the
/// server making the request does not belong to a planning unit.
///
/// No PUT: the host is the whole row, so there is nothing to edit in place — replacing
/// one is a delete and a create, same as swapping an id.
/// </summary>
public static class AllowedCalendarHostsAdminEndpoints
{
    public static void MapAllowedCalendarHostsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/allowed-calendar-hosts")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.AllowedCalendarHosts.AsNoTracking().OrderBy(h => h.Host).ToListAsync(ct)))
            .Produces<IReadOnlyList<AllowedCalendarHost>>();

        group.MapPost("/", async (
            AllowedCalendarHostRequest req, ClaimsPrincipal user, ActorResolver actors,
            ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!user.Has(AppRole.Admin, null)) return GlobalOnly();

            var host = NormalizeOrNull(req.Host);
            var v = new AdminValidation().Check(nameof(req.Host), host is not null, "must be a bare hostname, e.g. calendar.example.com.");
            if (v.ToBadRequestOrNull() is { } bad) return bad;

            if (await db.AllowedCalendarHosts.AnyAsync(h => h.Host == host, ct))
                return Results.Ok(new AllowedCalendarHost { Host = host! });

            var row = new AllowedCalendarHost { Host = host! };
            db.AllowedCalendarHosts.Add(row);
            db.RecordConfiguration(HistoryAction.Created, "allowed-calendar-host",
                $"{host} added to the holiday-import allowlist", row, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/allowed-calendar-hosts/{Uri.EscapeDataString(host!)}", row);
        })
        .Produces<AllowedCalendarHost>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapDelete("/{host}", async (
            string host, ClaimsPrincipal user, ActorResolver actors, ScheduleDbContext db, CancellationToken ct) =>
        {
            if (!user.Has(AppRole.Admin, null)) return GlobalOnly();

            var row = await db.AllowedCalendarHosts.FirstOrDefaultAsync(h => h.Host == host, ct);
            if (row is null) return AdminValidation.NotFound("allowed-calendar-host", host);

            db.AllowedCalendarHosts.Remove(row);
            db.RecordConfiguration(HistoryAction.Deleted, "allowed-calendar-host",
                $"{host} removed from the holiday-import allowlist", null, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);
    }

    /// <summary>Lowercased, trimmed, and rejected if it is not a bare host — no scheme,
    /// no path, no port. A caller pasting a whole calendar URL by habit should get told
    /// what is wrong rather than have it silently fail to match on the next request.</summary>
    private static string? NormalizeOrNull(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return null;
        var trimmed = host.Trim();
        if (trimmed.Contains('/') || trimmed.Contains(' ') || trimmed.Contains(':')) return null;
        return Uri.CheckHostName(trimmed) == UriHostNameType.Unknown ? null : trimmed.ToLowerInvariant();
    }

    private static IResult GlobalOnly() =>
        Results.Json(
            new ErrorResponse("GLOBAL_ADMIN_REQUIRED",
                "The holiday-import allowlist applies to every unit's imports, so changing it needs a global administrator."),
            statusCode: StatusCodes.Status403Forbidden);
}

public record AllowedCalendarHostRequest(string Host);
