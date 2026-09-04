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
/// External delivery hangs off <see cref="NotificationDelivery"/>, written in the same
/// transaction as this row (ADR-0064). The three outbox columns that used to sit here
/// held one channel, and one channel cannot express "email and Teams".
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

    /// <summary>The recipient's own state. An administrator reading the log does not
    /// touch it (ADR-0064).</summary>
    public DateTimeOffset? ReadAt { get; set; }

    /// <summary>What this notification is owed on, per channel (ADR-0064). Empty means the
    /// inbox and nothing else — which is every notification until a matrix cell is ticked.</summary>
    public List<NotificationDelivery> Deliveries { get; set; } = [];
}
