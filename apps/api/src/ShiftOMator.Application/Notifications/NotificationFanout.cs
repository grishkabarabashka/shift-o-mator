using ShiftOMator.Domain;

namespace ShiftOMator.Application.Notifications;

/// <summary>
/// Which channels one notification is owed on, given the matrix (ADR-0064).
///
/// Pure, and separate from the writer, for the reason every engine in this project is:
/// the decision is testable without a database, and the thing that holds a
/// <c>DbContext</c> is left with no policy in it at all.
///
/// <b>This runs when the notification is written, not when it is sent.</b> The rows it
/// plans record the policy in force at the moment of the event; a later edit to the matrix
/// does not reach back into what is already queued.
/// </summary>
public static class NotificationFanout
{
    /// <summary>One channel's verdict. <paramref name="SkipReason"/> null means owed.</summary>
    public sealed record Planned(NotificationChannel Channel, NotificationSkipReason? SkipReason);

    /// <summary>
    /// Plans over the rules that exist, and only those.
    ///
    /// WHY a missing rule row produces nothing rather than a skip: a channel with no row
    /// is one the seeder has not caught up with, not a decision anybody made, and a log
    /// full of skips for a channel nobody has heard of teaches the reader to ignore skips.
    /// <see cref="NotificationChannel.InApp"/> never appears here — the notification row
    /// itself is the inbox.
    /// </summary>
    public static IReadOnlyList<Planned> Plan(
        NotificationKind kind,
        IReadOnlyList<NotificationRule> rules) =>
        rules
            .Where(r => r.Kind == kind && r.Channel != NotificationChannel.InApp)
            .OrderBy(r => r.Channel)
            .Select(r => new Planned(
                r.Channel,
                r.Enabled ? null : NotificationSkipReason.ChannelDisabled))
            .ToList();

    /// <summary>
    /// The full matrix a fresh database starts with: every kind against every real
    /// channel, off.
    ///
    /// Off, because a system nobody has configured must not start mailing eighty people on
    /// the strength of a default — and because there is no sender yet, an enabled row would
    /// promise something the process cannot do.
    /// </summary>
    public static IReadOnlyList<NotificationRule> DefaultMatrix() =>
        Enum.GetValues<NotificationKind>()
            .SelectMany(kind => Enum.GetValues<NotificationChannel>()
                .Where(channel => channel != NotificationChannel.InApp)
                .Select(channel => new NotificationRule
                {
                    Id = NotificationRule.IdFor(kind, channel),
                    Kind = kind,
                    Channel = channel,
                    Enabled = false,
                    // Everything is overridable except being told a decision about your
                    // own request: those four are the outcome of something you asked for,
                    // and "I opted out of being told my leave was declined" is not a state
                    // the product should let somebody reach.
                    UserOverridable = kind is not (
                        NotificationKind.RequestApproved
                        or NotificationKind.RequestRejected
                        or NotificationKind.RequestSuperseded
                        or NotificationKind.RequestApplyFailed),
                }))
            .ToList();
}
