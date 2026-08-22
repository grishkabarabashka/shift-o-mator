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
    public async Task Every_request_gets_the_stub_identity_applied()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/auth/me");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("p-planner", body.GetProperty("personId").GetString());
        Assert.Equal("Planner", body.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Auth_me_reflects_the_configured_stub_role()
    {
        var client = ViewerFactory.CreateClient();
        var response = await client.GetAsync("/api/auth/me");
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Viewer", body.GetProperty("role").GetString());
    }

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
            editorPersonId = "p-planner",
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
            byPersonId = "p-planner",
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Planner_can_open_and_discard_a_draft()
    {
        var client = factory.CreateClient();

        var openResponse = await client.PostAsJsonAsync("/api/drafts", new
        {
            editorPersonId = "p-planner",
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
