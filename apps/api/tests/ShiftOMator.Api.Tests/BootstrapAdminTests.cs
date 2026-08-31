using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// The one-time link that lets somebody sign in to a fresh database (ADR-0058).
///
/// Linking is otherwise circular: outside Stub mode a caller is resolved by matching
/// their token's email against <c>Person.Email</c>, which an admin fills in on a screen
/// nobody can reach until somebody is already linked. <c>Auth:BootstrapAdminEmail</c>
/// breaks that, and the property that makes it safe to leave configured is that it
/// **disarms itself** — which is what the first test here pins down.
///
/// Its own database, because the rule is guarded on the state of the whole People table
/// ("nobody has an email"): any other test writing an email would turn it off, and the
/// suite would then pass for the wrong reason.
/// </summary>
public class BootstrapAdminTests
{
    private const string DatabaseName = "ShiftOMatorBootstrapTests";
    private const string FirstEmail = "first@example.test";

    /// <summary>Stub mode throughout: the bootstrap runs in the seeder and is indifferent
    /// to how callers authenticate. "Admin" only buys the test a way to read the roster
    /// back.</summary>
    private static ApiTestFactory Factory(string? bootstrapEmail) =>
        new()
        {
            DatabaseName = DatabaseName,
            StubRole = "Admin",
            Settings = bootstrapEmail is null
                ? new Dictionary<string, string>()
                : new Dictionary<string, string> { ["Auth:BootstrapAdminEmail"] = bootstrapEmail },
        };

    private static async Task<List<(string Id, string? Email)>> PeopleAsync(ApiTestFactory factory)
    {
        var people = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/admin/people");
        return [.. people.EnumerateArray().Select(p => (
            p.GetProperty("id").GetString()!,
            p.TryGetProperty("email", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null))];
    }

    [Fact]
    public async Task It_links_the_configured_address_and_then_never_acts_again()
    {
        // One test, two starts, because the interesting behaviour is the *transition*.
        // Splitting it would make each half depend on the other having run first, which is
        // the ordering coupling the separate database exists to avoid.
        string linkedPersonId;

        using (var first = Factory(FirstEmail))
        {
            var linked = (await PeopleAsync(first)).Where(p => p.Email is not null).ToList();

            var one = Assert.Single(linked);
            Assert.Equal(FirstEmail, one.Email);
            linkedPersonId = one.Id;

            // It has to attach to somebody who can administer, or the link lets you in and
            // leaves you unable to link anybody else — the circle unbroken.
            var grants = await first.CreateClient()
                .GetFromJsonAsync<JsonElement>("/api/admin/role-assignments");

            Assert.Contains(
                grants.EnumerateArray(),
                g => g.GetProperty("personId").GetString() == linkedPersonId
                    && g.GetProperty("role").GetString() == "admin"
                    && g.GetProperty("unitId").ValueKind == JsonValueKind.Null);
        }

        // A second start, a different address, the same database. The guard is "no person
        // has an email at all", so having linked one this must do nothing. That is the
        // whole safety argument for leaving the setting in a values file: it cannot
        // promote a second person later, and cannot restore a grant somebody removed.
        using var second = Factory("second@example.test");
        var after = await PeopleAsync(second);

        Assert.DoesNotContain(after, p => p.Email == "second@example.test");
        Assert.Equal(FirstEmail, Assert.Single(after, p => p.Id == linkedPersonId).Email);
    }

    [Fact]
    public async Task An_unset_address_links_nobody()
    {
        // The default, and the shape a real deployment should end up in: a database nobody
        // configured a bootstrap for comes up with no sign-in accounts rather than
        // guessing one.
        //
        // Order-independent on purpose. Run before the test above there are no emails at
        // all; run after, the only one is the address that test wrote. Either way nothing
        // here invents one.
        using var factory = Factory(bootstrapEmail: null);

        var people = await PeopleAsync(factory);

        Assert.All(
            people.Where(p => p.Email is not null),
            p => Assert.Equal(FirstEmail, p.Email));
    }
}
