using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The notification manager (ADR-0064): the matrix an administrator sets, and the log that
/// says what became of each notification.
///
/// Nothing here sends anything — that is step 3. What these prove is the half that has to
/// be right before a sender exists: that ticking a cell makes the next event *owed* on
/// that channel, and that an untouched cell leaves a skipped row saying so rather than
/// leaving nothing at all.
/// </summary>
[Collection("Api")]
public class NotificationsAdminTests(ApiTestFactory factory) : IDisposable
{
    private ApiTestFactory? _admin;
    private ApiTestFactory Admin => _admin ??= new ApiTestFactory { StubRole = "Admin" };

    public void Dispose() => _admin?.Dispose();

    private static int _dayOffset;

    /// <summary>Distinct dates per test: the shared database accumulates requests, and an
    /// overlapping range would make assertions order-dependent.</summary>
    private static (string From, string To) NextRange()
    {
        var start = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(700 + Interlocked.Add(ref _dayOffset, 3));
        return (start.ToString("yyyy-MM-dd"), start.AddDays(1).ToString("yyyy-MM-dd"));
    }

    private async Task SetCellAsync(string kind, string channel, bool enabled)
    {
        var client = Admin.CreateClient();
        var rules = await client.GetFromJsonAsync<JsonElement>("/api/admin/notifications/rules");

        var body = rules.EnumerateArray().Select(r => new
        {
            kind = r.GetProperty("kind").GetString(),
            channel = r.GetProperty("channel").GetString(),
            enabled = r.GetProperty("kind").GetString() == kind
                && r.GetProperty("channel").GetString() == channel
                ? enabled
                : r.GetProperty("enabled").GetBoolean(),
            userOverridable = r.GetProperty("userOverridable").GetBoolean(),
        }).ToList();

        var response = await client.PutAsJsonAsync("/api/admin/notifications/rules", new { rules = body });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<string> RaiseRequestAsync(HttpClient client)
    {
        var types = await client.GetFromJsonAsync<JsonElement>("/api/request-types");
        var type = types.EnumerateArray().First(t => t.GetProperty("code").GetString() == "REMOTE");
        var (from, to) = NextRange();

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
            note = "notification fan-out",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var request = await created.Content.ReadFromJsonAsync<JsonElement>();
        return request.GetProperty("id").GetString()!;
    }

    private async Task<JsonElement> LogEntryForAsync(string requestId)
    {
        var log = await Admin.CreateClient()
            .GetFromJsonAsync<JsonElement>("/api/admin/notifications/log?kind=requestSubmitted&take=50");

        return log.GetProperty("items").EnumerateArray()
            .First(i => i.GetProperty("subjectId").GetString() == requestId);
    }

    [Fact]
    public async Task The_matrix_covers_every_kind_against_every_real_channel()
    {
        var rules = await Admin.CreateClient()
            .GetFromJsonAsync<JsonElement>("/api/admin/notifications/rules");

        var cells = rules.EnumerateArray()
            .Select(r => (Kind: r.GetProperty("kind").GetString(), Channel: r.GetProperty("channel").GetString()))
            .ToList();

        Assert.Contains(("requestSubmitted", "email"), cells);
        Assert.Contains(("compDayAging", "teams"), cells);
        // The inbox is not a cell: a checkbox for it would switch off the only place an
        // event is visible at all.
        Assert.DoesNotContain(cells, c => c.Channel == "inApp");
        Assert.Equal(cells.Count, cells.Distinct().Count());
    }

    [Fact]
    public async Task An_enabled_cell_makes_the_next_event_owed_and_a_disabled_one_leaves_a_reason()
    {
        await SetCellAsync("requestSubmitted", "email", enabled: true);
        try
        {
            var requestId = await RaiseRequestAsync(factory.CreateClient());
            var entry = await LogEntryForAsync(requestId);

            var deliveries = entry.GetProperty("deliveries").EnumerateArray().ToList();
            var email = deliveries.First(d => d.GetProperty("channel").GetString() == "email");
            var teams = deliveries.First(d => d.GetProperty("channel").GetString() == "teams");

            // Owed and waiting: there is no dispatcher yet, which is the point — the
            // fan-out is watchable before it can leave the building.
            Assert.Equal("pending", email.GetProperty("status").GetString());
            Assert.Null(email.GetProperty("skipReason").GetString());

            // And silence is never the answer to "why did this not go out".
            Assert.Equal("skipped", teams.GetProperty("status").GetString());
            Assert.Equal("channelDisabled", teams.GetProperty("skipReason").GetString());

            Assert.NotNull(entry.GetProperty("recipientName").GetString());
        }
        finally
        {
            await SetCellAsync("requestSubmitted", "email", enabled: false);
        }
    }

    /// <summary>Editing the matrix does not reach back into what is already queued: the
    /// delivery rows record the policy in force when the event happened.</summary>
    [Fact]
    public async Task Turning_a_cell_off_afterwards_leaves_what_was_already_owed_alone()
    {
        await SetCellAsync("requestSubmitted", "email", enabled: true);
        string requestId;
        try
        {
            requestId = await RaiseRequestAsync(factory.CreateClient());
        }
        finally
        {
            await SetCellAsync("requestSubmitted", "email", enabled: false);
        }

        var entry = await LogEntryForAsync(requestId);
        var email = entry.GetProperty("deliveries").EnumerateArray()
            .First(d => d.GetProperty("channel").GetString() == "email");

        Assert.Equal("pending", email.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Only_a_failed_delivery_can_be_retried()
    {
        await SetCellAsync("requestSubmitted", "email", enabled: true);
        string requestId;
        try
        {
            requestId = await RaiseRequestAsync(factory.CreateClient());
        }
        finally
        {
            await SetCellAsync("requestSubmitted", "email", enabled: false);
        }

        var entry = await LogEntryForAsync(requestId);
        var pending = entry.GetProperty("deliveries").EnumerateArray()
            .First(d => d.GetProperty("status").GetString() == "pending")
            .GetProperty("id").GetString();

        var response = await Admin.CreateClient()
            .PostAsJsonAsync($"/api/admin/notifications/log/deliveries/{pending}/retry", new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("DELIVERY_NOT_FAILED", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_cell_the_two_enums_do_not_produce_is_refused()
    {
        var response = await Admin.CreateClient().PutAsJsonAsync("/api/admin/notifications/rules", new
        {
            rules = new[] { new { kind = "requestSubmitted", channel = "inApp", enabled = true, userOverridable = true } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("UNKNOWN_NOTIFICATION_RULE", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_planner_can_neither_read_the_log_nor_change_the_matrix()
    {
        var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.GetAsync("/api/admin/notifications/log")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PutAsJsonAsync("/api/admin/notifications/rules",
                new { rules = Array.Empty<object>() })).StatusCode);
    }
}
