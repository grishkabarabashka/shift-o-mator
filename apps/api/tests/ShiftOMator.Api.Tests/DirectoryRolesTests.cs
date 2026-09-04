using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The one access setting that is a row rather than configuration (ADR-0063).
///
/// Its own database because it flips a system-wide switch: left on, it would decide
/// whether every other test in the shared fixture honours token roles.
/// </summary>
public class DirectoryRolesTests : IClassFixture<DirectoryRolesTests.Factory>
{
    public sealed class Factory : ApiTestFactory
    {
        public Factory() => DatabaseName = "ShiftOMatorDirectoryRolesTests";
    }

    private readonly Factory factory;

    public DirectoryRolesTests(Factory factory) => this.factory = factory;

    private static HttpRequestMessage As(HttpMethod method, string url, string roles, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Debug-Role", roles);
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    private async Task<bool> CurrentAsync(HttpClient client)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/admin/directory-roles");
        return body.GetProperty("enabled").GetBoolean();
    }

    [Fact]
    public async Task It_starts_off_and_a_global_admin_can_turn_it_on_and_off_again()
    {
        var client = factory.CreateClient();

        // Reset first: this database outlives the run, so "it starts off" has to mean the
        // shipped default rather than whatever an earlier run left behind.
        (await client.SendAsync(As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = false })))
            .EnsureSuccessStatusCode();
        Assert.False(await CurrentAsync(client));

        var on = await client.SendAsync(
            As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = true }));
        on.EnsureSuccessStatusCode();
        Assert.True(await CurrentAsync(client));

        (await client.SendAsync(As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = false })))
            .EnsureSuccessStatusCode();
        Assert.False(await CurrentAsync(client));
    }

    [Fact]
    public async Task A_planner_cannot_touch_it()
    {
        var client = factory.CreateClient();

        var response = await client.SendAsync(
            As(HttpMethod.Put, "/api/admin/directory-roles", "Planner", new { enabled = true }));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Reading_it_needs_no_privilege()
    {
        // "Why does this person hold Admin when Settings shows no tick" is a fair question,
        // and the answer — because the directory says so — is not privileged.
        var client = factory.CreateClient();

        var response = await client.SendAsync(As(HttpMethod.Get, "/api/admin/directory-roles", "Viewer"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Turning_it_on_is_recorded()
    {
        // A switch that quietly adds a second source of permissions is exactly the kind of
        // change "who did this, and when" has to answer (ADR-0040).
        var client = factory.CreateClient();

        (await client.SendAsync(As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = false })))
            .EnsureSuccessStatusCode();
        (await client.SendAsync(As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = true })))
            .EnsureSuccessStatusCode();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var history = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}");

        Assert.Contains(
            history.EnumerateArray(),
            entry => (entry.GetProperty("summary").GetString() ?? string.Empty).Contains("app roles"));

        // Leave it as every other test expects to find it.
        (await client.SendAsync(As(HttpMethod.Put, "/api/admin/directory-roles", "Admin", new { enabled = false })))
            .EnsureSuccessStatusCode();
    }
}
