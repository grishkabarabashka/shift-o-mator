using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// <c>Person.Email</c> is what an Entra sign-in resolves to a person by (ADR-0058), so a
/// duplicate is not a cosmetic clash: it would make which person a token maps to depend
/// on row order. Same filtered-unique-index shape as <c>EmployeeId</c>, and the same
/// mirrored server-side check — so the client gets one field error instead of an
/// unhandled unique-constraint exception.
/// </summary>
/// <remarks>
/// Its own database, because these tests add people and
/// <see cref="ReferenceEndpointsTests"/> asserts the roster's exact size against the
/// fixture. Cleaning up after each case would work until the first one failed halfway and
/// left a row behind, and the symptom would be an unrelated test failing on a count.
/// </remarks>
public class PersonEmailTests : IClassFixture<PersonEmailTests.Factory>
{
    public sealed class Factory : ApiTestFactory
    {
        public Factory()
        {
            DatabaseName = "ShiftOMatorPersonEmailTests";
            StubRole = "Admin";
        }
    }

    private readonly Factory factory;

    public PersonEmailTests(Factory factory) => this.factory = factory;

    private static HttpRequestMessage AsAdmin(HttpMethod method, string url, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Debug-Role", "Admin");
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    /// <summary>Unit and location are read from the seeded reference data rather than
    /// hard-coded: their ids are fixture detail, and a test that fails because one was
    /// renamed says nothing about the thing it is meant to be checking.</summary>
    private async Task<object> NewPersonAsync(string displayName, string? email)
    {
        var reference = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/reference");
        return new
        {
            displayName,
            initials = displayName[..2].ToUpperInvariant(),
            employeeId = (string?)null,
            email,
            unitId = reference.GetProperty("units").EnumerateArray().First().GetProperty("id").GetString(),
            locationId = reference.GetProperty("locations").EnumerateArray().First().GetProperty("id").GetString(),
            orgCategory = "support",
            isActive = true,
            isIncluded = true,
        };
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> PostAsync(string displayName, string? email)
    {
        var person = await NewPersonAsync(displayName, email);
        var response = await factory.CreateClient().SendAsync(AsAdmin(HttpMethod.Post, "/api/admin/people", person));
        return (response.StatusCode, await response.Content.ReadFromJsonAsync<JsonElement>());
    }

    [Fact]
    public async Task An_address_already_in_use_is_a_field_error()
    {
        var address = $"dup-{Guid.NewGuid():N}@example.test";

        var (firstStatus, _) = await PostAsync("Dup One", address);
        Assert.Equal(HttpStatusCode.Created, firstStatus);

        var (secondStatus, body) = await PostAsync("Dup Two", address);

        Assert.Equal(HttpStatusCode.BadRequest, secondStatus);
        Assert.Contains("EMAIL_TAKEN", body.ToString());
    }

    [Fact]
    public async Task Casing_does_not_make_it_a_different_address()
    {
        // Normalized on write, because the token's casing is not ours to predict. Without
        // this the index would happily hold two rows that a sign-in cannot choose between.
        var address = $"case-{Guid.NewGuid():N}@example.test";

        Assert.Equal(HttpStatusCode.Created, (await PostAsync("Case One", address)).Status);
        var (status, body) = await PostAsync("Case Two", address.ToUpperInvariant());

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("EMAIL_TAKEN", body.ToString());
    }

    [Fact]
    public async Task It_is_stored_lowercased()
    {
        var address = $"Mixed-{Guid.NewGuid():N}@Example.Test";

        var (status, body) = await PostAsync("Mixed Case", address);

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal(address.ToLowerInvariant(), body.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Blank_is_stored_as_no_address_rather_than_an_empty_one()
    {
        // Two people who both left it blank must not collide. An empty string is a value
        // the unique index enforces; null is the absence the filtered index ignores.
        Assert.Equal(HttpStatusCode.Created, (await PostAsync("Blank One", "")).Status);

        var (status, body) = await PostAsync("Blank Two", "   ");

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("email").ValueKind);
    }

    [Fact]
    public async Task Something_that_is_not_an_address_is_refused()
    {
        var (status, body) = await PostAsync("Not Email", "no-at-sign");

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("email", body.ToString(), StringComparison.OrdinalIgnoreCase);
    }
}
