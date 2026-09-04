using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

/// <summary>One cell of the matrix, as the screen sends it back.</summary>
public sealed record NotificationRuleUpdate(
    NotificationKind Kind,
    NotificationChannel Channel,
    bool Enabled,
    bool UserOverridable);

/// <summary>
/// The whole matrix in one PUT.
///
/// WHY the whole thing rather than a cell at a time: the screen is a grid of checkboxes
/// and an administrator ticks several before saving. Fourteen requests for one intent
/// would also make "what changed" fourteen history rows. This is not the batch of
/// ADR-0061 — no cell can invalidate another, so there is no ordering to get right; it is
/// one screen, one save.
/// </summary>
public sealed record NotificationRulesRequest(IReadOnlyList<NotificationRuleUpdate> Rules);

/// <summary>One delivery, flattened for the log.</summary>
public sealed record NotificationDeliveryView(
    string Id,
    NotificationChannel Channel,
    NotificationDeliveryStatus Status,
    NotificationSkipReason? SkipReason,
    int Attempts,
    string? LastError,
    DateTimeOffset? SentAt);

/// <summary>
/// One notification as the administrator's log shows it: who it was for, what it said,
/// and what happened on each channel.
///
/// <see cref="RecipientName"/> is resolved here rather than on the client because the log
/// reaches back further than any roster the screen has loaded, and a row naming a person
/// id is a row nobody can read.
/// </summary>
public sealed record NotificationLogEntry(
    string Id,
    string RecipientPersonId,
    string? RecipientName,
    NotificationKind Kind,
    string Title,
    string? Body,
    string? SubjectType,
    string? SubjectId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReadAt,
    IReadOnlyList<NotificationDeliveryView> Deliveries);

public sealed record NotificationLogResponse(
    IReadOnlyList<NotificationLogEntry> Items,
    int Total);
