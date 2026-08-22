using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace ShiftOMator.Api.Auth;

/// <summary>Scheme options carrying the fixed stub identity's role, set once at
/// registration time from <c>Auth:StubRole</c> — see <c>Program.cs</c>.</summary>
public class StubAuthenticationSchemeOptions : AuthenticationSchemeOptions
{
    public string Role { get; set; } = "Planner";
}

/// <summary>
/// Local-dev/demo convenience, not a security boundary: issues a fixed
/// <see cref="ClaimsPrincipal"/> for every request — no token is read or validated.
/// Active when <c>Auth:Mode=Stub</c> (the default). A real deployment sets
/// <c>Auth:Mode=EntraId</c> and gets genuine JWT bearer validation instead
/// (<c>Program.cs</c>) without any endpoint or policy changing.
/// </summary>
public class StubAuthenticationHandler(
    IOptionsMonitor<StubAuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<StubAuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Stub";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "p-planner"),
            new Claim("personId", "p-planner"),
            new Claim(ClaimTypes.Name, "Planner (stub)"),
            new Claim(ClaimTypes.Role, Options.Role),
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
