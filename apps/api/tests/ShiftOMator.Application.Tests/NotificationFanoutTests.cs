using ShiftOMator.Application.Notifications;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Which channels an event is owed on (ADR-0064). The policy half of the notification
/// manager, tested without a database — the writer that puts these rows down holds no
/// decisions of its own.
/// </summary>
public class NotificationFanoutTests
{
    private static NotificationRule Rule(
        NotificationKind kind, NotificationChannel channel, bool enabled) => new()
    {
        Id = NotificationRule.IdFor(kind, channel),
        Kind = kind,
        Channel = channel,
        Enabled = enabled,
    };

    [Fact]
    public void An_enabled_cell_is_owed_and_a_disabled_one_is_skipped_with_a_reason()
    {
        var planned = NotificationFanout.Plan(NotificationKind.RequestSubmitted,
        [
            Rule(NotificationKind.RequestSubmitted, NotificationChannel.Email, enabled: true),
            Rule(NotificationKind.RequestSubmitted, NotificationChannel.Teams, enabled: false),
        ]);

        Assert.Equal(2, planned.Count);
        Assert.Null(planned.Single(p => p.Channel == NotificationChannel.Email).SkipReason);
        Assert.Equal(NotificationSkipReason.ChannelDisabled,
            planned.Single(p => p.Channel == NotificationChannel.Teams).SkipReason);
    }

    /// <summary>A skipped row is the whole reason the log can distinguish "not owed one"
    /// from "lost one" — so a disabled channel must still produce something.</summary>
    [Fact]
    public void A_matrix_that_is_entirely_off_still_says_so_channel_by_channel()
    {
        var planned = NotificationFanout.Plan(NotificationKind.CompDayAging,
            NotificationFanout.DefaultMatrix());

        Assert.NotEmpty(planned);
        Assert.All(planned, p => Assert.Equal(NotificationSkipReason.ChannelDisabled, p.SkipReason));
    }

    [Fact]
    public void Rules_for_other_kinds_are_ignored()
    {
        var planned = NotificationFanout.Plan(NotificationKind.RequestApproved,
        [
            Rule(NotificationKind.RequestRejected, NotificationChannel.Email, enabled: true),
        ]);

        Assert.Empty(planned);
    }

    /// <summary>The inbox is not a channel anybody can switch off.</summary>
    [Fact]
    public void In_app_is_never_planned_and_never_seeded()
    {
        var planned = NotificationFanout.Plan(NotificationKind.RequestApproved,
        [
            Rule(NotificationKind.RequestApproved, NotificationChannel.InApp, enabled: true),
        ]);

        Assert.Empty(planned);
        Assert.DoesNotContain(NotificationFanout.DefaultMatrix(),
            r => r.Channel == NotificationChannel.InApp);
    }

    /// <summary>A channel with no row is one the seeder has not caught up with, not a
    /// decision — and a log full of skips for a channel nobody configured teaches the
    /// reader to ignore skips.</summary>
    [Fact]
    public void A_channel_with_no_rule_produces_nothing_rather_than_a_skip()
    {
        var planned = NotificationFanout.Plan(NotificationKind.RequestSubmitted,
        [
            Rule(NotificationKind.RequestSubmitted, NotificationChannel.Email, enabled: true),
        ]);

        Assert.Equal([NotificationChannel.Email], planned.Select(p => p.Channel));
    }

    [Fact]
    public void The_default_matrix_covers_every_kind_and_every_real_channel_switched_off()
    {
        var matrix = NotificationFanout.DefaultMatrix();
        var kinds = Enum.GetValues<NotificationKind>().Length;
        var channels = Enum.GetValues<NotificationChannel>().Length - 1; // InApp is not a cell

        Assert.Equal(kinds * channels, matrix.Count);
        Assert.All(matrix, r => Assert.False(r.Enabled));
        Assert.Equal(matrix.Count, matrix.Select(r => r.Id).Distinct().Count());
    }

    /// <summary>Being told the outcome of something you asked for is not opt-out-able.</summary>
    [Fact]
    public void A_decision_about_your_own_request_is_not_overridable()
    {
        var matrix = NotificationFanout.DefaultMatrix();

        Assert.All(matrix.Where(r => r.Kind is NotificationKind.RequestApproved
                or NotificationKind.RequestRejected
                or NotificationKind.RequestSuperseded
                or NotificationKind.RequestApplyFailed),
            r => Assert.False(r.UserOverridable));
        Assert.All(matrix.Where(r => r.Kind is NotificationKind.CompDayAging
                or NotificationKind.CoverageGap
                or NotificationKind.RequestSubmitted),
            r => Assert.True(r.UserOverridable));
    }

    [Fact]
    public void An_id_reads_as_the_pair_it_stands_for()
    {
        Assert.Equal("nr-request-apply-failed-email",
            NotificationRule.IdFor(NotificationKind.RequestApplyFailed, NotificationChannel.Email));
    }
}
