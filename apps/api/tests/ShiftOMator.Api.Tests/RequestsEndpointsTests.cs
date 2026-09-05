using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Self-service end to end (ADR-0047): raise a request, approve it, and check that the
/// thing it asked for actually exists afterwards.
///
/// The stub identity is a Planner, and the seeded presence route resolves to the unit's
/// managers — so in these tests the caller is usually both requester and approver. That
/// is exactly the "planner records it for themselves" path, and it exercises the same
/// code an approver hits.
/// </summary>
[Collection("Api")]
public class RequestsEndpointsTests(ApiTestFactory factory)
{
    private static int _dayOffset;

    /// <summary>Distinct dates per test: presence records accumulate in the shared
    /// database, and an overlapping range would make assertions order-dependent.</summary>
    private static (string From, string To) NextRange()
    {
        var start = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(400 + Interlocked.Add(ref _dayOffset, 3));
        return (start.ToString("yyyy-MM-dd"), start.AddDays(1).ToString("yyyy-MM-dd"));
    }

    private static async Task<string> MyPersonIdAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        return me.GetProperty("personId").GetString()!;
    }

    private static async Task<JsonElement> RequestTypeAsync(HttpClient client, string code)
    {
        var types = await client.GetFromJsonAsync<JsonElement>("/api/request-types");
        return types.EnumerateArray().First(t => t.GetProperty("code").GetString() == code);
    }

    [Fact]
    public async Task Request_types_are_seeded_and_readable()
    {
        var client = factory.CreateClient();
        var types = await client.GetFromJsonAsync<JsonElement>("/api/request-types");

        var codes = types.EnumerateArray().Select(t => t.GetProperty("code").GetString()).ToList();
        Assert.Contains("REMOTE", codes);
        Assert.Contains("VACATION", codes);
    }

    [Fact]
    public async Task Approving_a_remote_request_creates_the_presence_record()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
            note = "school run",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var request = await created.Content.ReadFromJsonAsync<JsonElement>();
        var requestId = request.GetProperty("id").GetString();
        Assert.Equal("SUBMITTED", request.GetProperty("state").GetString());

        var decided = await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new
        {
            decision = "APPROVE",
            comment = "fine",
        });
        Assert.Equal(HttpStatusCode.OK, decided.StatusCode);

        var after = await decided.Content.ReadFromJsonAsync<JsonElement>();
        // Approved *and* applied: the two are separate states, and the write happening is
        // what distinguishes them (ADR-0047).
        Assert.Equal("APPLIED", after.GetProperty("state").GetString());

        var presence = await client.GetFromJsonAsync<JsonElement>($"/api/presence?from={from}&to={to}");
        var records = presence.GetProperty("presence").EnumerateArray().ToList();
        Assert.Contains(records, p =>
            p.GetProperty("typeId").GetString() == "pt-remote"
            && p.GetProperty("requestId").GetString() == requestId
            && p.GetProperty("source").GetString() == "REQUEST");
    }

    [Fact]
    public async Task Approving_a_leave_request_creates_the_absence()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "VACATION");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var decided = await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new { decision = "APPROVE" });
        Assert.Equal(HttpStatusCode.OK, decided.StatusCode);

        var me = await MyPersonIdAsync(client);
        var schedule = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId=ALL_UNITS&from={from}&to={to}");
        var absences = schedule.GetProperty("plan").GetProperty("absences").EnumerateArray().ToList();

        // The type is a row now, not an enum member (ADR-0049).
        Assert.Contains(absences, a =>
            a.GetProperty("personId").GetString() == me
            && a.GetProperty("eventTypeId").GetString() == "et-vacation");
    }

    [Fact]
    public async Task A_rejected_request_creates_nothing()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var decided = await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new
        {
            decision = "REJECT",
            comment = "coverage",
        });
        var after = await decided.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("REJECTED", after.GetProperty("state").GetString());

        var presence = await client.GetFromJsonAsync<JsonElement>($"/api/presence?from={from}&to={to}");
        Assert.DoesNotContain(
            presence.GetProperty("presence").EnumerateArray(),
            p => p.GetProperty("requestId").GetString() == requestId);
    }

    [Fact]
    public async Task Withdrawing_an_applied_request_removes_what_it_created()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new { decision = "APPROVE" });

        var cancelled = await client.PostAsync($"/api/requests/{requestId}/cancel", null);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);

        // WHY this matters: leaving the presence behind would show the roster something
        // the person explicitly withdrew.
        var presence = await client.GetFromJsonAsync<JsonElement>($"/api/presence?from={from}&to={to}");
        Assert.DoesNotContain(
            presence.GetProperty("presence").EnumerateArray(),
            p => p.GetProperty("requestId").GetString() == requestId);
    }

    [Fact]
    public async Task A_decided_request_cannot_be_decided_twice()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new { decision = "APPROVE" });
        var second = await client.PostAsJsonAsync($"/api/requests/{requestId}/decide", new { decision = "REJECT" });

        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("REQUEST_NOT_PENDING", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task An_unknown_request_type_is_refused()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = "rt-does-not-exist",
            from,
            to,
        });

        Assert.Equal(HttpStatusCode.BadRequest, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("REQUEST_TYPE_NOT_FOUND", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Submitting_a_request_notifies_the_approver()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });

        // The stub identity is a unit manager, so the seeded planner route routes back to
        // the same person — which is what makes this assertable without a second client.
        var notifications = await client.GetFromJsonAsync<JsonElement>("/api/notifications?unreadOnly=true");
        Assert.True(notifications.GetProperty("unreadCount").GetInt32() > 0);
        Assert.Contains(
            notifications.GetProperty("notifications").EnumerateArray(),
            n => n.GetProperty("subjectType").GetString() == "request");
    }

    [Fact]
    public async Task My_requests_and_my_inbox_are_separate_views()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        var created = await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });
        var requestId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();

        var mine = await client.GetFromJsonAsync<JsonElement>("/api/requests?scope=mine");
        Assert.Contains(
            mine.GetProperty("requests").EnumerateArray(),
            r => r.GetProperty("request").GetProperty("id").GetString() == requestId);

        var inbox = await client.GetFromJsonAsync<JsonElement>("/api/requests?scope=inbox");
        Assert.Contains(
            inbox.GetProperty("requests").EnumerateArray(),
            r => r.GetProperty("request").GetProperty("id").GetString() == requestId
                 && r.GetProperty("callerCanDecide").GetBoolean());
    }

    [Fact]
    public async Task Marking_notifications_read_clears_the_unread_count()
    {
        var client = factory.CreateClient();
        var (from, to) = NextRange();
        var type = await RequestTypeAsync(client, "REMOTE");

        await client.PostAsJsonAsync("/api/requests", new
        {
            typeId = type.GetProperty("id").GetString(),
            from,
            to,
        });

        var read = await client.PostAsync("/api/notifications/read", null);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var after = await client.GetFromJsonAsync<JsonElement>("/api/notifications?unreadOnly=true");
        Assert.Equal(0, after.GetProperty("unreadCount").GetInt32());
    }
}
