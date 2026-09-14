using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Resolves the acting <see cref="Person"/> for a request — the one place that answers
/// "who is doing this" (ADR-0039).
///
/// WHY a service and not a claims read: the audit trail is the entire access-control
/// model (ADR-0032), so an actor id that names no real person produces history rows that
/// cannot be read back. The claim is therefore checked against the roster, not trusted
/// on its face.
///
/// WHY a fallback in Stub mode: <see cref="StubAuthenticationHandler"/> stamps a fixed
/// <c>p-planner</c> that is deliberately not in the seeded roster, and there is no local
/// IdP to develop against. Rather than let every dev-mode write name a phantom — which
/// is what the client used to paper over by guessing "the first manager in scope" — the
/// stub resolves to one real, deterministic person. Outside Stub mode there is no
/// fallback at all: an unmapped principal is refused.
///
/// WHY email outside Stub mode: an Entra ID token names a directory account, and nothing
/// in it knows this product's person ids. Email is the one identifier both sides hold, and
/// an admin links it by hand on Settings → People (ADR-0058). A <c>personId</c> claim is
/// only ever issued by the stub handler, so trusting one from a real token would mean
/// trusting a claim the IdP never sets — hence the two paths are kept apart rather than
/// falling through from one to the other.
/// </summary>
public sealed class ActorResolver(
    ShiftOMatorDbContext db,
    IOptions<AuthOptions> authOptions,
    ILogger<ActorResolver> logger)
{
    private string? _cached;

    /// <summary>
    /// The acting person's id — the impersonation subject when a lens is open, otherwise
    /// the signed-in person. Throws <see cref="UnmappedPrincipalException"/> when the
    /// principal cannot be mapped, which the exception handler turns into
    /// <c>403 PRINCIPAL_NOT_MAPPED</c>.
    ///
    /// WHY a lens moves this and ADR-0039 still holds: the claim it reads is stamped by
    /// <see cref="RoleClaimsTransformation"/> only after a server-side permission check, so
    /// it is no more caller-supplied than the token is. What ADR-0039 forbids is an actor
    /// taken from a request *body*, which anybody could write; this one has to be earned.
    /// The administrator is not lost either — <see cref="RequireRealActorAsync"/> names them
    /// and every audit row carries them (ADR-0069).
    /// </summary>
    public async Task<string> RequireAsync(ClaimsPrincipal user, CancellationToken ct = default) =>
        user.SubjectOrNull() ?? await RequireRealActorAsync(user, ct);

    /// <summary>
    /// The signed-in person, lens or no lens. Two callers only: the audit stamp, and the
    /// claims transformation that decides whether a lens may be opened at all — both of
    /// which are asking "who is really here", which is a different question from "whose
    /// change is this".
    /// </summary>
    public async Task<string> RequireRealActorAsync(ClaimsPrincipal user, CancellationToken ct = default)
    {
        if (_cached is not null) return _cached;

        var isStub = string.Equals(authOptions.Value.Mode, "Stub", StringComparison.OrdinalIgnoreCase);

        if (!isStub)
        {
            // Lowercased to match how the admin screen stores it; the database collation
            // is case-insensitive anyway, but a provider that is not would silently stop
            // matching, and that failure looks like "my account stopped working".
            var email = user.EmailOrNull()?.Trim().ToLowerInvariant()
                ?? throw new UnmappedPrincipalException(null);

            // EF translates this to SQL, where the default collation is case-insensitive
            // and the filtered unique index on Email enforces that at most one row matches.
            var byEmail = await db.People.AsNoTracking()
                .Where(p => p.Email == email)
                .Select(p => p.Id)
                .FirstOrDefaultAsync(ct)
                ?? throw new UnmappedPrincipalException(email);

            return _cached = byEmail;
        }

        var claimed = user.PersonIdOrNull();
        if (claimed is not null && await db.People.AsNoTracking().AnyAsync(p => p.Id == claimed, ct))
            return _cached = claimed;

        var fallback = await db.People.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderByDescending(p => p.OrgCategory == OrgCategory.Management)
            .ThenBy(p => p.Id)
            .Select(p => p.Id)
            .FirstOrDefaultAsync(ct)
            ?? throw new UnmappedPrincipalException(claimed);

        logger.LogWarning(
            "Stub auth: principal {Claimed} is not in the roster; acting as {Fallback}. "
            + "Set Auth:StubPersonId to a real person id to pin this.", claimed, fallback);
        return _cached = fallback;
    }

    /// <summary>The acting person's display name, for endpoints that echo identity back.</summary>
    public async Task<Person?> RequirePersonAsync(ClaimsPrincipal user, CancellationToken ct = default)
    {
        var id = await RequireAsync(user, ct);
        return await db.People.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
    }
}
