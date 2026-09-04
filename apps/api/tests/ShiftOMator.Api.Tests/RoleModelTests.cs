using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Roles are a set, scoped to a planning unit (ADR-0051).
///
/// The defect these pin down was structural: policies compared roles by ordinal, so
/// <c>Admin &gt; Planner</c> made every administrator a planner of every unit — a right
/// nobody had granted and nobody could withhold.
/// </summary>
[Collection("Api")]
public class RoleModelTests(ApiTestFactory factory)
{
    private static HttpRequestMessage As(HttpMethod method, string url, string roles)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Debug-Role", roles);
        return request;
    }

    [Fact]
    public async Task An_admin_cannot_open_a_draft()
    {
        // The headline consequence of deleting the ordinal. Administering settings and
        // owning the rota are different jobs.
        var client = factory.CreateClient();
        var request = As(HttpMethod.Post, "/api/drafts", "Admin");
        request.Content = JsonContent.Create(new
        {
            unitId = "ALL_UNITS",
            rangeFrom = "2026-01-01",
            rangeTo = "2026-01-07",
        });

        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task A_planner_cannot_reach_the_admin_surface()
    {
        // And the converse: the ordinal denied this one correctly, but only by accident of
        // ordering rather than because anybody decided it.
        var client = factory.CreateClient();

        var response = await client.SendAsync(As(HttpMethod.Get, "/api/admin/units", "Planner"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Holding_two_roles_grants_both()
    {
        var client = factory.CreateClient();

        var draft = As(HttpMethod.Post, "/api/drafts", "Planner,Admin");
        draft.Content = JsonContent.Create(new
        {
            unitId = "ALL_UNITS",
            rangeFrom = "2026-02-01",
            rangeTo = "2026-02-07",
        });

        // Created or OK: the endpoint resumes an open draft rather than minting a second
        // one, and which of the two this is depends on test ordering. What is being
        // asserted here is that it is not 403.
        Assert.True((await client.SendAsync(draft)).IsSuccessStatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.SendAsync(As(HttpMethod.Get, "/api/admin/units", "Planner,Admin"))).StatusCode);
    }

    [Fact]
    public async Task The_default_identity_gets_the_grants_it_actually_holds()
    {
        // The defect that made every role invisible: `Auth:StubRole` defaulted to "Planner"
        // in both Program.cs and appsettings.json, so the role *override* was permanently
        // on and the stored grants were never read. Nobody was ever an Admin or an
        // Approver, Settings never appeared, and no Approve button rendered.
        //
        // The second half: with no pinned person the token carries no person id, and the
        // claims transformation read the claim rather than resolving the actor — so the
        // default identity was a real person for every write and yet had no grants.
        //
        // No StubRole here on purpose: this is the shipped configuration, where grants come
        // from the database. The class fixture pins a role, which is the very thing that
        // hid this.
        using var real = new ApiTestFactory { StubRole = string.Empty };
        var client = real.CreateClient();

        var response = await client.GetAsync("/api/auth/me");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        var personId = body.GetProperty("personId").GetString();
        Assert.NotNull(personId);

        var roles = body.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString())
            .ToList();

        // The seed makes every manager a planner, approver and admin of their unit, and
        // ActorResolver prefers a manager — so the default identity has real grants, not
        // just the Viewer everybody gets.
        Assert.Contains("admin", roles);
        Assert.Contains("approver", roles);
        Assert.Contains("planner", roles);
    }

    [Fact]
    public async Task Every_unit_has_somebody_who_can_plan_and_approve_it()
    {
        // A unit with no manager used to come up with nobody able to do anything in it,
        // and the only symptom was every screen being read-only for no stated reason.
        var client = factory.CreateClient();

        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var units = reference.GetProperty("units").EnumerateArray()
            .Select(u => u.GetProperty("id").GetString()!)
            .ToList();

        var grants = await client.GetFromJsonAsync<JsonElement>("/api/admin/role-assignments");
        var byUnit = grants.EnumerateArray()
            .Where(g => g.GetProperty("unitId").ValueKind != JsonValueKind.Null)
            .Select(g => (Unit: g.GetProperty("unitId").GetString()!, Role: g.GetProperty("role").GetString()!))
            .ToList();

        foreach (var unit in units)
        {
            Assert.Contains(byUnit, g => g.Unit == unit && g.Role == "planner");
            Assert.Contains(byUnit, g => g.Unit == unit && g.Role == "approver");
        }
    }

    [Fact]
    public async Task Reading_who_holds_what_needs_no_privilege()
    {
        // "Who approves my leave" is a fair question for the person waiting on an answer,
        // and there was no way to find out: you could not see who administers anything
        // without already administering something.
        var client = factory.CreateClient();

        var response = await client.SendAsync(
            As(HttpMethod.Get, "/api/admin/role-assignments", "Viewer"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Auth_me_reports_every_grant_with_its_scope()
    {
        var client = factory.CreateClient();

        var response = await client.SendAsync(As(HttpMethod.Get, "/api/auth/me", "Planner,Approver"));
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        var roles = body.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString())
            .ToList();

        Assert.Contains("planner", roles);
        Assert.Contains("approver", roles);
        // Everyone signed in reads the rota; it is not a stored grant.
        Assert.Contains("viewer", roles);
    }

    [Fact]
    public async Task A_viewer_cannot_grant_a_role()
    {
        var client = factory.CreateClient();
        var request = As(HttpMethod.Post, "/api/admin/role-assignments", "Viewer");
        request.Content = JsonContent.Create(new { personId = "p-1", unitId = "unit-amer", role = "planner" });

        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Viewer_is_not_grantable_because_everyone_already_has_it()
    {
        var client = factory.CreateClient();
        var people = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someone = people.GetProperty("people").EnumerateArray().First().GetProperty("id").GetString();

        var request = As(HttpMethod.Post, "/api/admin/role-assignments", "Admin");
        request.Content = JsonContent.Create(new { personId = someone, unitId = (string?)null, role = "viewer" });

        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ROLE_NOT_GRANTABLE", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Granting_the_same_role_twice_is_the_same_grant()
    {
        // Not an error and not a second row: granting something already held is not a
        // stronger grant, and two rows could only ever disagree about who granted it.
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someone = reference.GetProperty("people").EnumerateArray().Last().GetProperty("id").GetString();
        var unit = reference.GetProperty("units").EnumerateArray().First().GetProperty("id").GetString();

        async Task<JsonElement> Grant()
        {
            var request = As(HttpMethod.Post, "/api/admin/role-assignments", "Admin");
            request.Content = JsonContent.Create(new { personId = someone, unitId = unit, role = "approver" });
            var response = await client.SendAsync(request);
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        var first = await Grant();
        var second = await Grant();

        Assert.Equal(first.GetProperty("id").GetString(), second.GetProperty("id").GetString());
    }

    [Fact]
    public async Task A_grant_is_recorded_in_the_audit_trail()
    {
        // "Who made them an approver" is the first question after a bad approval, and a
        // write path with no history row is a bug (ADR-0040).
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someone = reference.GetProperty("people").EnumerateArray()
            .Skip(1).First().GetProperty("id").GetString();
        var unit = reference.GetProperty("units").EnumerateArray().First().GetProperty("id").GetString();

        // Revoked first, and that is not tidiness. Granting is idempotent: an existing
        // grant comes back 200 and writes **no** history row, so on every run after the
        // first this test asserted against a row written by an earlier one — and failed
        // outright once that row aged out of today's window. The subject here is "a *new*
        // grant is recorded", so the test has to start from not holding it.
        var existing = await client.GetFromJsonAsync<JsonElement>(
            $"/api/admin/role-assignments?unitId={unit}");
        foreach (var row in existing.EnumerateArray())
        {
            if (row.GetProperty("personId").GetString() != someone) continue;
            if (!string.Equals(row.GetProperty("role").GetString(), "planner", StringComparison.OrdinalIgnoreCase)) continue;
            var id = row.GetProperty("id").GetString();
            (await client.SendAsync(As(HttpMethod.Delete, $"/api/admin/role-assignments/{id}", "Admin")))
                .EnsureSuccessStatusCode();
        }

        var grant = As(HttpMethod.Post, "/api/admin/role-assignments", "Admin");
        grant.Content = JsonContent.Create(new { personId = someone, unitId = unit, role = "planner" });
        (await client.SendAsync(grant)).EnsureSuccessStatusCode();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var history = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}");
        var entries = history.EnumerateArray()
            .Select(e => e.GetProperty("summary").GetString() ?? string.Empty)
            .ToList();

        Assert.Contains(entries, s => s.Contains("Granted") && s.Contains(someone!));
    }
}
