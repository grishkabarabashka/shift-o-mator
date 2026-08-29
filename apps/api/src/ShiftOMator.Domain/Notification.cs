namespace ShiftOMator.Domain;

/// <summary>What happened. Kept coarse on purpose — the title and body carry the detail,
/// and this only decides grouping and (later) which channel a delivery preference
/// applies to.</summary>
public enum NotificationKind
{
    RequestSubmitted,
    RequestApproved,
    RequestRejected,
    RequestApplyFailed,
    /// <summary>A newer request replaced this one before anybody decided it — the comp-day
    /// "only one live proposal" rule (ADR-0056), stated as the same fact a rejection is.</summary>
    RequestSuperseded,
    CompDayAging,
    CoverageGap,
}

/// <summary>
/// One item in a person's in-app inbox (ADR-0046).
///
/// WHY a table written inside the same transaction as the change that caused it, rather
/// than a queue or a mail send: there is no background worker in this application, and
/// adding infrastructure is not the cheapest way to stop dropping notifications on the
/// floor. A row written transactionally cannot be lost by a crash between the state
/// change and the notification, and the client already polls.
///
/// The same table becomes a transactional outbox when external delivery arrives:
/// <see cref="Channel"/> and <see cref="DeliveredAt"/> are the two columns that need
/// filling in, and nothing above them changes.
/// </summary>
public class Notification
{
    public required string Id { get; set; }
    public required string RecipientPersonId { get; set; }
    public NotificationKind Kind { get; set; }
    public required string Title { get; set; }
    public string? Body { get; set; }

    /// <summary>What this is about, so the client can deep-link. Free-form because the
    /// set of subjects will grow.</summary>
    public string? SubjectType { get; set; }
    public string? SubjectId { get; set; }

    public required DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }

    /// <summary>Outbox fields, unused until external delivery is wired up. Present now so
    /// adding delivery is a dispatcher, not a migration and a backfill.</summary>
    public string? Channel { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public int DeliveryAttempts { get; set; }
}
