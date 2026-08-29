using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Requests;

/// <summary>
/// Writes inbox items (ADR-0046).
///
/// Every method here only calls <c>Add</c>: the rows are saved by the caller's
/// <c>SaveChangesAsync</c>, inside the same transaction as the change that caused them.
/// That is the whole design — a notification cannot be lost by a crash between the state
/// change and the send, because there is no send.
/// </summary>
public static class Notifier
{
    public static void Notify(
        this ScheduleDbContext db,
        IEnumerable<string> recipientPersonIds,
        NotificationKind kind,
        string title,
        string? body,
        string subjectType,
        string subjectId,
        DateTimeOffset now)
    {
        // Distinct, because a route can resolve the same person twice (named on a step
        // and also the fallback) and two identical bells is a bug, not thoroughness.
        foreach (var recipient in recipientPersonIds.Where(id => !string.IsNullOrEmpty(id)).Distinct())
        {
            db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid().ToString("n"),
                RecipientPersonId = recipient,
                Kind = kind,
                Title = title,
                Body = body,
                SubjectType = subjectType,
                SubjectId = subjectId,
                CreatedAt = now,
            });
        }
    }
}
