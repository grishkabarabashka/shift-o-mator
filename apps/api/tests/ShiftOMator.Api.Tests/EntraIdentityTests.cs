using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Setup;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// What happens when the caller arrives with a real token instead of the stub's
/// fabricated identity (ADR-0058).
///
/// Two things are under test and they are easy to conflate. **Resolution**: the token
/// names a directory account, and <c>ActorResolver</c> turns that into a
/// <c>Person</c> by matching its email — the only identifier both sides hold.
/// **Authorization**: Entra app roles are read from the token — only when
/// <c>SystemSetup.DirectoryRoles</c> is on (ADR-0062, ADR-0063) — and are then *added to* the grants
/// stored in the database, never substituted for them, because per-unit scope is a
/// concept no identity provider knows about (ADR-0051).
///
/// WHY a fake scheme rather than a real JWT: signing one needs a key and an issuer, and
/// what would then be under test is <c>AddJwtBearer</c> — Microsoft's code, already
/// tested. Everything downstream of "the token validated and produced these claims" is
/// ours, and that is where the bugs live. The scheme therefore emits exactly the claim
/// shapes Entra emits and nothing else.
/// </summary>
public class EntraIdentityTests
{
    private const string DatabaseName = "ShiftOMatorEntraTests";
    private const string AdminEmail = "entra-admin@example.test";

    /// <summary>The claims for the next request, set per test. The handler is resolved by
    /// the framework, so this is the seam that carries a test's intent into it.</summary>
    private sealed class TokenClaims
    {
        public string? Email { get; set; }
        public string EmailClaimType { get; set; } = "preferred_username";
        public string[] Roles { get; set; } = [];
    }

    private sealed class FakeTokenHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        TokenClaims token)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string SchemeName = "FakeEntra";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new List<Claim>();
            if (token.Email is not null) claims.Add(new Claim(token.EmailClaimType, token.Email));
            foreach (var role in token.Roles) claims.Add(new Claim("roles", role));

            var identity = new ClaimsIdentity(claims, SchemeName);
            return Task.FromResult(AuthenticateResult.Success(
                new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
        }
    }

    /// <summary>
    /// `Auth:Mode` is anything but "Stub", which is what puts <c>ActorResolver</c> on its
    /// email path with no fallback. Seeding here does what the setup wizard's Demo preset
    /// would do outside Stub mode: seed the fixture, then link <see cref="AdminEmail"/> to
    /// whichever seeded manager holds the global Admin grant — the same escape from the
    /// linking circle a real first deployment uses (ADR-0059).
    /// </summary>
    private sealed class EntraFactory : ApiTestFactory
    {
        public TokenClaims Token { get; } = new();

        public EntraFactory()
            : base()
        {
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton(Token);
                services.AddAuthentication(FakeTokenHandler.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, FakeTokenHandler>(
                        FakeTokenHandler.SchemeName, _ => { });
            });
        }

        /// <summary>Whether this system honours Entra app roles — a row, not a setting
        /// (ADR-0063), so the test writes it where the product reads it.</summary>
        public bool DirectoryRoles { get; init; }

        protected override async Task SeedAsync(IHost host)
        {
            using var scope = host.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ShiftOMatorDbContext>();
            if (await SetupService.IsRequiredAsync(db))
                await SetupService.CompleteDemoAsync(db, callerEmail: AdminEmail);

            // Set every time, not only on first seed: this database is shared across the
            // class and outlives the run, so a test that left the switch on would decide
            // the answer for the next one.
            var setup = await db.SystemSetups.FirstAsync();
            setup.DirectoryRoles = DirectoryRoles;
            await db.SaveChangesAsync();
        }
    }

    private static EntraFactory Factory(bool directoryRoles = false) => new()
    {
        DatabaseName = DatabaseName,
        DirectoryRoles = directoryRoles,
        Settings = new Dictionary<string, string> { ["Auth:Mode"] = "EntraId" },
    };

    [Fact]
    public async Task The_token_email_resolves_to_the_person_it_was_linked_to()
    {
        using var factory = Factory();
        factory.Token.Email = AdminEmail;

        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("personId").GetString()));
        // The switcher must not appear outside stub mode: it sets headers only the stub
        // handler reads, so offering it would be a control that silently does nothing.
        Assert.False(body.GetProperty("stubMode").GetBoolean());
    }

    [Theory]
    [InlineData("preferred_username")]
    [InlineData("email")]
    [InlineData(ClaimTypes.Email)]
    [InlineData(ClaimTypes.Upn)]
    public async Task Every_claim_type_Entra_might_use_for_the_email_is_read(string claimType)
    {
        // Which of these arrives depends on tenant configuration nobody here controls, so
        // all four are read rather than one being assumed. Getting this wrong looks like
        // "signs in fine, then 403 for everything" — and only for some tenants.
        using var factory = Factory();
        factory.Token.Email = AdminEmail;
        factory.Token.EmailClaimType = claimType;

        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task The_match_ignores_how_the_address_was_cased()
    {
        // Stored lowercased, and the token's casing is not ours to predict. A provider
        // whose collation differs from SQL Server's would otherwise stop matching, and the
        // failure reads as "my account stopped working" with nothing changed.
        using var factory = Factory();
        factory.Token.Email = AdminEmail.ToUpperInvariant();

        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task An_address_nobody_holds_is_refused_and_the_message_names_it()
    {
        // Deliberately fatal rather than falling back to somebody: a write attributed to
        // nobody defeats the audit trail that is the whole access-control model
        // (ADR-0039). The address is echoed so the person can send it to an administrator
        // instead of reporting "403".
        using var factory = Factory();
        factory.Token.Email = "stranger@example.test";

        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("PRINCIPAL_NOT_MAPPED", body.GetProperty("code").GetString());
        Assert.Contains("stranger@example.test", body.GetProperty("message").GetString()!);
    }

    [Fact]
    public async Task A_token_carrying_no_email_at_all_is_refused()
    {
        // There is no fallback outside stub mode. A principal we cannot name is not a
        // principal we can attribute anything to.
        using var factory = Factory();
        factory.Token.Email = null;

        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_app_role_is_ignored_unless_the_deployment_asked_for_directory_roles()
    {
        // The default, and the point of ADR-0062: a grant the directory hands out does not
        // appear on Settings → Roles and cannot be revoked there, so by default it is not
        // honoured at all. What the screen shows is then the whole truth.
        using var factory = Factory();
        factory.Token.Email = AdminEmail;
        factory.Token.Roles = ["Planner"];

        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/auth/me");
        var grants = body.GetProperty("roles").EnumerateArray()
            .Select(r => (
                Role: r.GetProperty("role").GetString(),
                Unit: r.GetProperty("unitId").ValueKind == JsonValueKind.Null
                    ? null
                    : r.GetProperty("unitId").GetString()))
            .ToList();

        // The seed gives the linked manager a *unit-scoped* planner grant and a global
        // admin one. A **global planner** could only have come from the token.
        Assert.DoesNotContain(grants, g => g is { Role: "Planner", Unit: null });
        // The stored grants are untouched — this switch removes a source, not a person.
        Assert.Contains(grants, g => g is { Role: "Approver", Unit: not null });
    }

    [Fact]
    public async Task An_app_role_from_the_token_adds_to_the_stored_grants_when_switched_on()
    {
        // The property most at risk from a refactor: token roles are *additive*. Holding
        // two roles grants both (ADR-0051), and an identity provider that could replace
        // the database's per-unit grants would silently widen or erase somebody's scope.
        //
        // The seed gives the linked manager planner/approver/admin **of their own unit**
        // plus a **global** admin. So a global *planner* can only have come from the
        // token — that is the assertion.
        using var factory = Factory(directoryRoles: true);
        factory.Token.Email = AdminEmail;
        factory.Token.Roles = ["Planner"];

        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/auth/me");
        var grants = body.GetProperty("roles").EnumerateArray()
            .Select(r => (
                Role: r.GetProperty("role").GetString(),
                Unit: r.GetProperty("unitId").ValueKind == JsonValueKind.Null
                    ? null
                    : r.GetProperty("unitId").GetString()))
            .ToList();

        Assert.Contains(grants, g => g is { Role: "Planner", Unit: null });
        // Still there: the token added, it did not replace.
        Assert.Contains(grants, g => g is { Role: "Approver", Unit: not null });
    }

    [Fact]
    public async Task A_role_this_product_does_not_have_is_ignored_rather_than_refused()
    {
        // The same directory account may hold roles for other applications. That is not
        // this app's business, and rejecting the token over it would lock people out of
        // this product for something configured elsewhere.
        using var factory = Factory(directoryRoles: true);
        factory.Token.Email = AdminEmail;
        factory.Token.Roles = ["SomeOtherApp.Reader", "Approver"];

        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/auth/me");
        var roles = body.GetProperty("roles").EnumerateArray()
            .Select(r => r.GetProperty("role").GetString())
            .ToList();

        Assert.Contains("Approver", roles);
        Assert.DoesNotContain(roles, r => r is not null && r.Contains("SomeOtherApp"));
    }
}
