using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Acting as somebody else (ADR-0069).
///
/// The properties worth pinning, because getting any of them wrong is invisible from the
/// screen: the lens makes the subject the **actor** — their identity, their roles, their
/// rows — the administrator is still recorded on everything written while it is open, and
/// the scope rule refuses the two cases that would turn it into an escalation.
///
/// Every case runs against a factory with <c>Auth:StubRole</c> empty, so the stored grants
/// are the ones under test. The shared collection's factory pins "Planner" globally, which
/// would make every caller able to act as nobody and hide the scope rule entirely.
/// </summary>
[Collection("Api")]
public class ImpersonationTests(ApiTestFactory factory) : IDisposable
{
    private ApiTestFactory? _real;

    private ApiTestFactory Real => _real ??= new ApiTestFactory { StubRole = string.Empty };

    public void Dispose()
    {
        _real?.Dispose();
        GC.SuppressFinalize(this);
    }

    private sealed record Cast(string AdminId, string AdminUnit, string SameUnitId, string OtherUnitId, string GlobalAdminId);

    /// <summary>
    /// A manager (seeded as Admin of their own unit), somebody else in that unit, somebody
    /// in a different one, and the one person holding a global grant. Read from the roster
    /// rather than hard-coded: the demo preset trims people per unit, so ids that exist
    /// today may not tomorrow.
    /// </summary>
    private async Task<Cast> CastAsync()
    {
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var people = reference.GetProperty("people").EnumerateArray()
            .Select(p => (
                Id: p.GetProperty("id").GetString()!,
                Unit: p.GetProperty("unitId").GetString()!,
                Category: p.GetProperty("orgCategory").GetString()!,
                Active: p.GetProperty("isActive").GetBoolean()))
            .Where(p => p.Active)
            .ToList();

        // The fixture seeds one *global* Admin. Picking them as the caller would make the
        // scope cases pass for free — a global grant widens scope by design (ADR-0051) —
        // and they are also the subject the global-grant rule exists to protect.
        var grants = await client.GetFromJsonAsync<JsonElement>("/api/admin/role-assignments");
        var globalAdmins = grants.EnumerateArray()
            .Where(g => g.GetProperty("role").GetString() == "Admin"
                && g.GetProperty("unitId").ValueKind == JsonValueKind.Null)
            .Select(g => g.GetProperty("personId").GetString()!)
            .ToHashSet();

        var admin = people.First(p => p.Category == "MANAGEMENT" && !globalAdmins.Contains(p.Id));
        var sameUnit = people.First(p => p.Unit == admin.Unit && p.Id != admin.Id);
        var otherUnit = people.First(p => p.Unit != admin.Unit);

        return new Cast(admin.Id, admin.Unit, sameUnit.Id, otherUnit.Id, globalAdmins.First());
    }

    private HttpRequestMessage As(HttpMethod method, string url, string personId, string? lens = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Debug-PersonId", personId);
        if (lens is not null) request.Headers.Add("X-Impersonate-PersonId", lens);
        return request;
    }

    private async Task OpenAsync(HttpClient client, Cast cast, string subjectId)
    {
        var open = As(HttpMethod.Post, "/api/auth/impersonate", cast.AdminId);
        open.Content = JsonContent.Create(new { personId = subjectId });
        (await client.SendAsync(open)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task The_actor_becomes_the_subject_and_the_administrator_is_still_named()
    {
        var cast = await CastAsync();
        var client = Real.CreateClient();
        await OpenAsync(client, cast, cast.SameUnitId);

        var me = await client.SendAsync(As(HttpMethod.Get, "/api/auth/me", cast.AdminId, cast.SameUnitId));
        me.EnsureSuccessStatusCode();
        var body = await me.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(cast.SameUnitId, body.GetProperty("personId").GetString());
        Assert.Equal(cast.AdminId, body.GetProperty("impersonatedBy").GetProperty("personId").GetString());

        // The way back has to stay offered: the grants on the principal are now the
        // subject's, so this must not be read off them.
        Assert.True(body.GetProperty("canImpersonate").GetBoolean());
    }

    [Fact]
    public async Task The_administrators_own_roles_do_not_come_along()
    {
        // The failure this catches is a union rather than a replacement — a caller who ends
        // up more powerful than either person, which is the one outcome a lens must never
        // produce. An engineer holds no grants, so the answer is Viewer and nothing else.
        var cast = await CastAsync();
        var client = Real.CreateClient();
        await OpenAsync(client, cast, cast.SameUnitId);

        var me = await client.SendAsync(As(HttpMethod.Get, "/api/auth/me", cast.AdminId, cast.SameUnitId));
        var body = await me.Content.ReadFromJsonAsync<JsonElement>();

        var roles = body.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString())
            .ToHashSet();

        Assert.DoesNotContain("Admin", roles);
    }

    [Fact]
    public async Task A_write_under_a_lens_belongs_to_the_subject_and_records_the_administrator()
    {
        // The whole point, and the part that is only true because of the interceptor: the
        // change *is* the subject's, and the trail still names who actually made it.
        //
        // `UNAVAILABLE` is the one seeded event type needing no approval (ADR-0049), which
        // is what makes this reachable as an engineer rather than as an approver.
        var cast = await CastAsync();
        var client = Real.CreateClient();
        await OpenAsync(client, cast, cast.SameUnitId);

        const string date = "2027-04-14";
        var write = As(HttpMethod.Post, "/api/absences", cast.AdminId, cast.SameUnitId);
        write.Content = JsonContent.Create(new
        {
            personId = cast.SameUnitId,
            eventTypeId = "et-unavailable",
            from = date,
            to = date,
        });
        (await client.SendAsync(write)).EnsureSuccessStatusCode();

        var history = await client.SendAsync(As(
            HttpMethod.Get,
            $"/api/history/cell?personId={cast.SameUnitId}&date={date}",
            cast.AdminId));
        history.EnsureSuccessStatusCode();
        var body = await history.Content.ReadFromJsonAsync<JsonElement>();

        var actors = body.GetProperty("events").EnumerateArray()
            .Select(e => (Id: e.GetProperty("actorId").GetString(), Name: e.GetProperty("actorName").GetString()))
            .ToList();

        // Theirs, by id…
        Assert.Contains(actors, a => a.Id == cast.SameUnitId);
        // …and the administrator is in the label, which is where a reader will look.
        Assert.Contains(actors, a => a.Name is not null && a.Name.Contains("(by "));
    }

    [Fact]
    public async Task A_lens_over_another_unit_is_refused()
    {
        // The scope argument in ADR-0069 is that a unit Admin could grant themselves any
        // role in their own unit anyway. It does not hold one unit over.
        var cast = await CastAsync();
        var client = Real.CreateClient();

        var open = As(HttpMethod.Post, "/api/auth/impersonate", cast.AdminId);
        open.Content = JsonContent.Create(new { personId = cast.OtherUnitId });

        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(open)).StatusCode);
    }

    [Fact]
    public async Task A_lens_over_a_global_grant_you_lack_is_refused()
    {
        // Without this rule, a unit Admin acts as whoever holds the global Admin grant — who
        // may well sit in their own unit — and comes out administering every unit. That
        // crosses the very boundary the scope argument depends on.
        var cast = await CastAsync();
        var client = Real.CreateClient();

        var open = As(HttpMethod.Post, "/api/auth/impersonate", cast.AdminId);
        open.Content = JsonContent.Create(new { personId = cast.GlobalAdminId });

        var response = await client.SendAsync(open);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("IMPERSONATION_FORBIDDEN", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_header_nobody_approved_is_refused_rather_than_ignored()
    {
        // The failure this exists to catch: dropping the header quietly would show the
        // caller their *own* rows under somebody else's name, with nothing on screen wrong.
        var cast = await CastAsync();
        var client = Real.CreateClient();

        var response = await client.SendAsync(
            As(HttpMethod.Get, "/api/auth/me", cast.SameUnitId, cast.OtherUnitId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("IMPERSONATION_FORBIDDEN", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_calendar_feed_address_is_never_handed_over()
    {
        // The one thing a lens does not carry: the token in that URL is the whole
        // authentication on the only anonymous route in the product, and it outlives the
        // lens with nothing to show the subject it was taken.
        var cast = await CastAsync();
        var client = Real.CreateClient();

        var response = await client.SendAsync(
            As(HttpMethod.Get, "/api/me/calendar-feed", cast.AdminId, cast.SameUnitId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("IMPERSONATION_READ_ONLY", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_subject_is_told_it_happened()
    {
        var cast = await CastAsync();
        var client = Real.CreateClient();
        await OpenAsync(client, cast, cast.SameUnitId);

        var inbox = await client.SendAsync(As(HttpMethod.Get, "/api/notifications", cast.SameUnitId));
        inbox.EnsureSuccessStatusCode();
        var body = await inbox.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Contains(
            body.GetProperty("notifications").EnumerateArray(),
            item => item.GetProperty("kind").GetString() == "IMPERSONATED");
    }
}
