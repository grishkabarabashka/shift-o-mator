using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application.Notifications;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure.Notifications;

/// <summary>
/// The one place a notification is written (ADR-0044, ADR-0064).
///
/// Every method here only calls <c>Add</c>: the rows are saved by the caller's
/// <c>SaveChangesAsync</c>, inside the same transaction as the change that caused them.
/// That is the whole design — a notification cannot be lost by a crash between the state
/// change and the send, because there is no send.
///
/// WHY it lives in Infrastructure rather than Application, where ADR-0064 first put it:
/// Application references Domain and nothing else, and this needs the
/// <see cref="ScheduleDbContext"/>. The half that is policy — which channels an event is
/// owed on — is in <see cref="NotificationFanout"/>, where it is pure and tested; what is
/// left here is the write. Everything above Infrastructure can see this, which is what the
/// move was for: the comp-day and coverage kinds are computed in Application and could not
/// reach the old home in <c>Api/Requests</c> at all.
/// </summary>
public static class Notifier
{
    /// <summary>
    /// Writes an inbox row per recipient, plus its delivery rows for every channel the
    /// matrix has an opinion about.
    ///
    /// Async only because the matrix is read — it still adds and never saves. With an
    /// empty matrix this is exactly the behaviour that shipped before ADR-0064: the inbox
    /// row and nothing else, reached without a special case.
    /// </summary>
    public static async Task NotifyAsync(
        this ScheduleDbContext db,
        IEnumerable<string> recipientPersonIds,
        NotificationKind kind,
        string title,
        string? body,
        string subjectType,
        string subjectId,
        DateTimeOffset now,
        CancellationToken ct = default)
    {
        // Distinct, because a route can resolve the same person twice (named on a step
        // and also the fallback) and two identical bells is a bug, not thoroughness.
        var recipients = recipientPersonIds
            .Where(id => !string.IsNullOrEmpty(id))
            .Distinct()
            .ToList();
        if (recipients.Count == 0) return;

        var rules = await db.NotificationRules.AsNoTracking()
            .Where(r => r.Kind == kind)
            .ToListAsync(ct);
        var planned = NotificationFanout.Plan(kind, rules);

        foreach (var recipient in recipients)
        {
            var notification = new Notification
            {
                Id = Guid.NewGuid().ToString("n"),
                RecipientPersonId = recipient,
                Kind = kind,
                Title = title,
                Body = body,
                SubjectType = subjectType,
                SubjectId = subjectId,
                CreatedAt = now,
            };

            foreach (var plan in planned)
            {
                notification.Deliveries.Add(new NotificationDelivery
                {
                    Id = Guid.NewGuid().ToString("n"),
                    NotificationId = notification.Id,
                    Channel = plan.Channel,
                    Status = plan.SkipReason is null
                        ? NotificationDeliveryStatus.Pending
                        : NotificationDeliveryStatus.Skipped,
                    SkipReason = plan.SkipReason,
                    CreatedAt = now,
                });
            }

            db.Notifications.Add(notification);
        }
    }
}
