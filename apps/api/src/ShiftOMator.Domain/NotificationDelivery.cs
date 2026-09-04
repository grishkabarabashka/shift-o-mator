namespace ShiftOMator.Domain;

public enum NotificationDeliveryStatus
{
    /// <summary>Owed and not yet attempted. Until the dispatcher exists (step 3 of
    /// ADR-0064) rows simply accumulate here, which is what makes the fan-out watchable
    /// before anything is capable of sending it.</summary>
    Pending,
    Sent,
    Failed,
    /// <summary>Not owed, and why is in <see cref="NotificationDelivery.SkipReason"/>.</summary>
    Skipped,
}

/// <summary>Why nothing was sent. Every value here is an answer to "why did this person
/// not get the email" — the question the admin log exists to answer.</summary>
public enum NotificationSkipReason
{
    /// <summary>The matrix cell is off.</summary>
    ChannelDisabled,
    /// <summary>The recipient has no address for this channel.</summary>
    NoAddress,
    /// <summary>The recipient opted out, where the rule allows it (step 5 of ADR-0064).</summary>
    UserOptedOut,
}

/// <summary>
/// One notification's fate on one channel (ADR-0064).
///
/// A child table rather than columns on <see cref="Notification"/>, because a single
/// event can be owed to a person by email <b>and</b> Teams, and a row that holds one
/// channel cannot say that. ADR-0044 put the columns there to save a later migration; the
/// saving lasted exactly until the second channel.
///
/// <b>The fan-out is decided when the notification is written, not when it is sent.</b>
/// These rows therefore record the policy that was in force when the event happened —
/// editing the matrix does not rewrite what is already queued — and the dispatcher stays
/// a loop that takes <see cref="NotificationDeliveryStatus.Pending"/>, sends, and marks.
///
/// <b><see cref="NotificationDeliveryStatus.Skipped"/> is written, never omitted.</b>
/// Without it a missing row means both "not owed one" and "lost one", and the log cannot
/// tell those apart — which is the entire reason anybody opens it.
/// </summary>
public class NotificationDelivery
{
    public required string Id { get; set; }
    public required string NotificationId { get; set; }
    public NotificationChannel Channel { get; set; }
    public NotificationDeliveryStatus Status { get; set; }
    public NotificationSkipReason? SkipReason { get; set; }

    /// <summary>Attempts made, never reset — a retry that zeroed it would hide a channel
    /// that fails every single time.</summary>
    public int Attempts { get; set; }

    public string? LastError { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public required DateTimeOffset CreatedAt { get; set; }
}
