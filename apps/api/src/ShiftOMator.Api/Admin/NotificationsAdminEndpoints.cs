using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// The notification manager (ADR-0064): the matrix that decides what goes out, and the log
/// that says what happened.
///
/// Two halves on purpose. The matrix is policy an administrator sets; the log is evidence
/// nobody sets. The log answers one question — "why did this person not get the email" —
/// and it can only answer it because a skipped delivery is a row rather than an absence.
///
/// Nothing here sends anything. Until the dispatcher lands (step 3 of ADR-0064) an enabled
/// cell produces <see cref="NotificationDeliveryStatus.Pending"/> rows that accumulate,
/// which is the point: the fan-out is watchable before it is capable of leaving the
/// building.
/// </summary>
public static class NotificationsAdminEndpoints
{
    /// <summary>A page of log. Large enough that scrolling answers most questions, small
    /// enough that a year of history is never materialized by accident.</summary>
    private const int MaxPageSize = 200;

    public static void MapNotificationsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/notifications")
            .RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/rules", async (ShiftOMatorDbContext db, CancellationToken ct) =>
            Results.Ok(await db.NotificationRules.AsNoTracking()
                .OrderBy(r => r.Kind).ThenBy(r => r.Channel)
                .ToListAsync(ct)))
            .Produces<IReadOnlyList<NotificationRule>>();

        // The whole matrix at once: it is one screen of checkboxes and one intent.
        group.MapPut("/rules", async (
            NotificationRulesRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();

            var rules = await db.NotificationRules.ToListAsync(ct);
            var byKey = rules.ToDictionary(r => (r.Kind, r.Channel));

            var unknown = req.Rules
                .Where(u => !byKey.ContainsKey((u.Kind, u.Channel)))
                .ToList();
            if (unknown.Count > 0)
            {
                // A cell the seeder has not written cannot be created here: the matrix is
                // the product of two closed enums, so an unknown pair means the client is
                // ahead of the server, not that a row is missing.
                return Results.BadRequest(new ErrorResponse("UNKNOWN_NOTIFICATION_RULE",
                    $"No such cell: {string.Join(", ", unknown.Select(u => $"{u.Kind}/{u.Channel}"))}."));
            }

            var changed = new List<string>();
            foreach (var update in req.Rules)
            {
                var rule = byKey[(update.Kind, update.Channel)];
                if (rule.Enabled != update.Enabled)
                {
                    changed.Add($"{update.Kind}/{update.Channel} {(update.Enabled ? "on" : "off")}");
                }
                rule.Enabled = update.Enabled;
                rule.UserOverridable = update.UserOverridable;
            }

            if (changed.Count > 0)
            {
                // One row for one save. Which cells moved is the readable half; the whole
                // matrix goes in the snapshot for anybody reconstructing the policy that
                // was in force on a given day.
                db.RecordConfiguration(HistoryAction.Updated, "notification-rules",
                    $"Notification channels: {string.Join(", ", changed)}",
                    rules, await actors.RequireAsync(user, ct));
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(rules.OrderBy(r => r.Kind).ThenBy(r => r.Channel).ToList());
        })
        .Produces<IReadOnlyList<NotificationRule>>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden);

        group.MapGet("/log", async (
            string? kind, string? channel, string? status, string? personId,
            DateOnly? from, DateOnly? to, int? skip, int? take,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var query = db.Notifications.AsNoTracking().Include(n => n.Deliveries).AsQueryable();

            if (Enum.TryParse<NotificationKind>(kind, ignoreCase: true, out var wantedKind))
                query = query.Where(n => n.Kind == wantedKind);
            if (!string.IsNullOrWhiteSpace(personId))
                query = query.Where(n => n.RecipientPersonId == personId);
            if (from is { } f)
                query = query.Where(n => n.CreatedAt >= f.ToDateTime(TimeOnly.MinValue));
            if (to is { } t)
                query = query.Where(n => n.CreatedAt < t.AddDays(1).ToDateTime(TimeOnly.MinValue));

            // Channel and status filter the *notification* by what happened to it on some
            // channel — "show me everything that failed" means the rows a failure is on,
            // with their other channels still visible beside it.
            if (Enum.TryParse<NotificationChannel>(channel, ignoreCase: true, out var wantedChannel))
                query = query.Where(n => n.Deliveries.Any(d => d.Channel == wantedChannel));
            if (Enum.TryParse<NotificationDeliveryStatus>(status, ignoreCase: true, out var wantedStatus))
                query = query.Where(n => n.Deliveries.Any(d => d.Status == wantedStatus));

            var total = await query.CountAsync(ct);
            var page = await query
                .OrderByDescending(n => n.CreatedAt)
                .Skip(Math.Max(skip ?? 0, 0))
                .Take(Math.Clamp(take ?? 50, 1, MaxPageSize))
                .ToListAsync(ct);

            var names = await db.People.AsNoTracking()
                .Where(p => page.Select(n => n.RecipientPersonId).Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.DisplayName, ct);

            var items = page.Select(n => new NotificationLogEntry(
                n.Id, n.RecipientPersonId, names.GetValueOrDefault(n.RecipientPersonId),
                n.Kind, n.Title, n.Body, n.SubjectType, n.SubjectId, n.CreatedAt, n.ReadAt,
                n.Deliveries.OrderBy(d => d.Channel).Select(d => new NotificationDeliveryView(
                    d.Id, d.Channel, d.Status, d.SkipReason, d.Attempts, d.LastError, d.SentAt)).ToList()))
                .ToList();

            return Results.Ok(new NotificationLogResponse(items, total));
        })
        .Produces<NotificationLogResponse>();

        // Retry is the one write the log offers, and it only ever moves Failed back to
        // Pending. Attempts is not reset: the count is evidence, and zeroing it hides a
        // channel that fails every single time.
        group.MapPost("/log/deliveries/{id}/retry", async (
            string id, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!user.CanAdministerGlobally()) return GlobalOnly();

            var delivery = await db.NotificationDeliveries.FirstOrDefaultAsync(d => d.Id == id, ct);
            if (delivery is null) return AdminValidation.NotFound("delivery", id);

            if (delivery.Status != NotificationDeliveryStatus.Failed)
            {
                return Results.BadRequest(new ErrorResponse("DELIVERY_NOT_FAILED",
                    $"This delivery is {delivery.Status}. Only a failed one can be retried — "
                    + "a skipped one is answered by the matrix, not by trying again."));
            }

            delivery.Status = NotificationDeliveryStatus.Pending;

            db.RecordConfiguration(HistoryAction.Updated, delivery.Id,
                $"Retry {delivery.Channel} delivery", null, await actors.RequireAsync(user, ct));
            await db.SaveChangesAsync(ct);
            return Results.Ok(delivery);
        })
        .Produces<NotificationDelivery>()
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static IResult GlobalOnly() =>
        Results.Json(
            new ErrorResponse("GLOBAL_ADMIN_REQUIRED",
                "What the product sends means the same thing in every unit, so changing it "
                + "needs a global administrator."),
            statusCode: StatusCodes.Status403Forbidden);
}
