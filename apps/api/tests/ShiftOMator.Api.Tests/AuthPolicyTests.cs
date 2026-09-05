using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Proves the auth seam is real, not decorative: every request in Stub mode gets a
/// <c>ClaimsPrincipal</c> (there is no "unauthenticated" state to test against — the
/// stub handler always succeeds), so the meaningful assertion is that
/// <c>RequireAuthorization</c> policies actually discriminate by shift. A second
/// <see cref="ApiTestFactory"/>, stamped "Viewer" instead of the shared collection's
/// "Planner", gives us that lower-privilege caller without a second auth mode.
///
/// The second factory is created lazily inside test methods (not a constructor/field
/// initializer run for every test) and only after the shared "Api" collection fixture
/// has already migrated + seeded the database — <see cref="ApiCollection"/>'s own
/// remarks explain why two factories racing that startup work is the bug to avoid.
/// Because xUnit runs test classes within one collection sequentially, this ordering
/// holds without extra synchronization.
/// </summary>
[Collection("Api")]
public class AuthPolicyTests(ApiTestFactory factory) : IDisposable
{
    private ApiTestFactory? _viewerFactory;

    private ApiTestFactory ViewerFactory => _viewerFactory ??= new ApiTestFactory { StubRole = "Viewer" };

    public void Dispose() => _viewerFactory?.Dispose();

    [Fact]
    public async Task The_stub_identity_can_be_switched_per_request()
    {
        // WHY this exists: a role fixed once at startup makes "what does a Viewer see"
        // a restart per case. The headers are read only by StubAuthenticationHandler,
        // which only exists when Auth:Mode=Stub, so there is no path to them in a real
        // deployment.
        var client = factory.CreateClient();
        var reference = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        var someone = reference.GetProperty("people").EnumerateArray().First()
            .GetProperty("id").GetString();

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        request.Headers.Add("X-Debug-PersonId", someone);
        request.Headers.Add("X-Debug-Role", "Viewer");

        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(someone, body.GetProperty("personId").GetString());
        Assert.Equal(["Viewer"], RoleNames(body));
        Assert.True(body.GetProperty("stubMode").GetBoolean());
    }

    [Fact]
    public async Task A_switched_down_role_is_actually_enforced()
    {
        // The switcher has to change what the policies do, not just what the badge says.
        var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/drafts")
        {
            Content = JsonContent.Create(new
            {
                unitId = "ALL_UNITS",
                rangeFrom = "2026-01-01",
                rangeTo = "2026-01-07",
            }),
        };
        request.Headers.Add("X-Debug-Role", "Viewer");

        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Stub_identity_resolves_to_a_real_person_in_the_roster()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/auth/me");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var personId = body.GetProperty("personId").GetString();

        // ADR-0039: the stub claims `p-planner`, who is deliberately not in the seeded
        // roster. An id that names nobody produces audit rows that cannot be read back,
        // so ActorResolver substitutes one real, deterministic person instead — and this
        // is the id every write in the session will be attributed to.
        Assert.NotEqual("p-planner", personId);
        Assert.NotNull(personId);

        var people = await client.GetFromJsonAsync<JsonElement>("/api/reference");
        Assert.Contains(
            people.GetProperty("people").EnumerateArray(),
            p => p.GetProperty("id").GetString() == personId);

        Assert.Contains("Planner", RoleNames(body));
    }

    [Fact]
    public async Task Auth_me_reflects_the_configured_stub_role()
    {
        var client = ViewerFactory.CreateClient();
        var response = await client.GetAsync("/api/auth/me");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(["Viewer"], RoleNames(body));
    }

    /// <summary>Roles are a set now, so the assertion is about membership, not one
    /// name — and a global grant is the only kind the stub override produces.</summary>
    private static List<string> RoleNames(JsonElement body) =>
        [.. body.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString() ?? string.Empty)
            .Distinct()
            .Order()];

    [Fact]
    public async Task Viewer_can_read_reference_and_schedule_data()
    {
        var client = ViewerFactory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/reference")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/drafts")).StatusCode);
    }

    [Fact]
    public async Task Viewer_is_forbidden_from_opening_a_draft()
    {
        var client = ViewerFactory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/drafts", new
        {
            unitId = "ALL_UNITS",
            rangeFrom = "2026-01-01",
            rangeTo = "2026-01-07",
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Viewer_is_forbidden_from_acknowledging_an_issue()
    {
        var client = ViewerFactory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/acknowledgements", new
        {
            issueKey = "does-not-matter-should-be-rejected-before-lookup",
            comment = "test",
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Planner_can_open_and_discard_a_draft()
    {
        var client = factory.CreateClient();

        var openResponse = await client.PostAsJsonAsync("/api/drafts", new
        {
            unitId = "ALL_UNITS",
            rangeFrom = "2026-01-01",
            rangeTo = "2026-01-07",
        });
        openResponse.EnsureSuccessStatusCode();

        var draft = await openResponse.Content.ReadFromJsonAsync<JsonElement>();
        var id = draft.GetProperty("id").GetString();

        var discardResponse = await client.PostAsync($"/api/drafts/{id}/discard", content: null);
        Assert.Equal(HttpStatusCode.OK, discardResponse.StatusCode);
    }
}
