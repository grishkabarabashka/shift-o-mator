using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

public class StubAuthenticationSchemeOptions : AuthenticationSchemeOptions
{
    /// <summary>Fallback roles, from <c>Auth:StubRole</c>. Comma-separated: roles are a
    /// set now, and "Planner and Approver" is an ordinary thing to be (ADR-0051).
    /// Empty means "use the grants stored against this person".</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>Fallback person, from <c>Auth:StubPersonId</c>. Empty means "let
    /// <see cref="ActorResolver"/> pick one".</summary>
    public string PersonId { get; set; } = string.Empty;
}

/// <summary>
/// Local-dev identity, not a security boundary: issues a principal for every request
/// with no token read or validated. Active when <c>Auth:Mode=Stub</c>.
///
/// WHY it accepts per-request overrides: role behaviour is a thing that needs testing —
/// what a Viewer sees, what an approver can do — and a role fixed once at startup makes
/// that a restart per case. The headers are read **only** in this handler, which only
/// exists in stub mode, so there is no path to them in a real deployment.
/// </summary>
public class StubAuthenticationHandler(
    IOptionsMonitor<StubAuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<StubAuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Stub";

    public const string PersonHeader = "X-Debug-PersonId";
    public const string RoleHeader = "X-Debug-Role";

    /// <summary>Carries a requested role set through to
    /// <see cref="RoleClaimsTransformation"/>, which is where grants are resolved. The
    /// handler cannot resolve them itself — it has no database.</summary>
    public const string OverrideRolesClaim = "sfm:stub-roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var personId = Header(PersonHeader) ?? Options.PersonId;
        var roles = Header(RoleHeader) ?? Options.Role;

        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, string.IsNullOrEmpty(personId) ? "stub" : personId),
        };

        // Absent means "whatever this person actually holds", which is the realistic
        // path and therefore the default.
        if (!string.IsNullOrWhiteSpace(roles))
            claims.Add(new Claim(OverrideRolesClaim, roles));

        // An empty person id is left unclaimed rather than blank: ActorResolver treats
        // "no claim" as "pick a real person", and a blank one as a failed lookup.
        if (!string.IsNullOrEmpty(personId))
        {
            claims.Add(new Claim(ClaimTypes.NameIdentifier, personId));
            claims.Add(new Claim(CurrentUser.PersonIdClaim, personId));
        }

        var identity = new ClaimsIdentity(claims, SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }

    private string? Header(string name) =>
        Request.Headers.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString().Trim()
            : null;
}
