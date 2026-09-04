namespace ShiftOMator.Domain;

/// <summary>
/// Where a notification can go (ADR-0064).
///
/// WHY closed when <see cref="PresenceType"/> is open: a presence type needs no code, and
/// a channel is nothing but code. Every member here is a sender somebody has to write, so
/// a channel an administrator invented would be a row with nothing behind it.
/// </summary>
public enum NotificationChannel
{
    /// <summary>The <see cref="Notification"/> row itself. Present so the log can name it;
    /// it is deliberately absent from <see cref="NotificationRule"/> — see there.</summary>
    InApp,
    Email,
    Teams,
}

/// <summary>
/// One cell of the notification matrix: does this kind of event go out on this channel
/// (ADR-0064).
///
/// The two axes are closed enums and the cell between them is data, which is the whole
/// shape of this: adding a kind is code, adding a channel is code, but deciding that an
/// approval decision is worth an email is a decision the team makes on a Tuesday.
///
/// <b><see cref="NotificationChannel.InApp"/> has no row here.</b> The
/// <see cref="Notification"/> is the inbox, so a rule for it would be a checkbox that
/// switches off the only place an event is visible at all.
/// </summary>
public class NotificationRule
{
    /// <summary>
    /// Derived from the pair, and fixed: <c>nr-request-approved-email</c>.
    ///
    /// WHY an id at all when <see cref="Kind"/> and <see cref="Channel"/> are the real
    /// key: the seeder tops rows up by id (a kind added in code has to appear on the
    /// screen by itself), and every DTO, history entry and admin endpoint in this codebase
    /// addresses a row by a string id. The pair keeps a unique index, so it is still the
    /// key — it is just not the one the plumbing uses.
    /// </summary>
    public required string Id { get; set; }

    public NotificationKind Kind { get; set; }
    public NotificationChannel Channel { get; set; }

    /// <summary>Whether the fan-out writes a delivery for this pair at all. A rule that is
    /// off still produces a row in the log, with
    /// <see cref="NotificationSkipReason.ChannelDisabled"/> — see
    /// <see cref="NotificationDelivery"/> for why silence is not an answer.</summary>
    public bool Enabled { get; set; }

    /// <summary>Whether a person may turn this off for themselves once per-person
    /// preferences exist (step 5 of ADR-0064). Stored now because the admin screen is the
    /// place the answer belongs, and because "you cannot opt out of being told your leave
    /// was declined" is policy, not a missing feature.</summary>
    public bool UserOverridable { get; set; } = true;

    public static string IdFor(NotificationKind kind, NotificationChannel channel) =>
        $"nr-{Slug(kind.ToString())}-{Slug(channel.ToString())}";

    /// <summary>PascalCase to kebab, so the id reads as the pair it stands for.</summary>
    private static string Slug(string name) =>
        string.Concat(name.Select((c, i) =>
            char.IsUpper(c) && i > 0 ? "-" + char.ToLowerInvariant(c) : char.ToLowerInvariant(c).ToString()));
}
