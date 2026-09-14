using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Auth;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Notifications;

namespace ShiftOMator.Api;

/// <summary>
/// The client's identity, resolved the same way every write path resolves it
/// (<see cref="ActorResolver"/>, ADR-0039) — so "who am I" and "who will the audit trail
/// say I am" can never disagree. Before this, the client guessed its own identity by
/// picking the first manager in scope, and the two answers routinely differed.
///
/// Under an impersonation lens both answers move together, which is the point: the actor
/// *is* the subject (ADR-0069). What this endpoint adds is the second name — the
/// administrator behind it — because the header has to be able to say who is really there.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/api/auth/me", async (
            ClaimsPrincipal user, ActorResolver actors, IOptions<AuthOptions> auth,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var person = await actors.RequirePersonAsync(user, ct);

            // The whole grant list, not one role name: roles are a set and each is scoped
            // to a unit, so "can I plan here" is a question only the client asking about a
            // specific row can answer (ADR-0051). Under a lens these are the subject's,
            // because under a lens they are what authorization reads too.
            var grants = user.FindAll(Capabilities.RoleClaim)
                .Select(claim => claim.Value.Split('|', 2))
                .Where(parts => parts.Length == 2 && Enum.TryParse<AppRole>(parts[0], true, out _))
                .Select(parts => new RoleGrant(
                    Enum.Parse<AppRole>(parts[0], ignoreCase: true),
                    parts[1].Length == 0 ? null : parts[1]))
                .ToList();

            ImpersonatorSummary? by = null;
            if (user.ImpersonatorOrNull() is { } realId)
            {
                var real = await db.People.AsNoTracking().FirstOrDefaultAsync(p => p.Id == realId, ct);
                if (real is not null) by = new ImpersonatorSummary(real.Id, real.DisplayName);
            }

            return Results.Ok(new MeResponse(
                person?.Id,
                person?.DisplayName ?? user.Identity?.Name,
                grants,
                string.Equals(auth.Value.Mode, "Stub", StringComparison.OrdinalIgnoreCase),
                by,
                // Read from the *real* person's grants, not the principal's: under a lens the
                // principal carries the subject's, and an engineer's screen would otherwise
                // stop offering the administrator a way on to somebody else.
                await CanImpersonateAsync(db, user, ct)));
        })
        .WithName("GetCurrentUser")
        .Produces<MeResponse>()
        .RequireAuthorization(AuthPolicies.Authenticated);

        // WHY starting a lens is a POST and not just a header the client starts sending:
        // the permission check would happen either way, but the *record* would not. This is
        // the one call that writes "Hanna Weber acted as Bob Rivera" into the history and
        // into Bob's inbox. Doing it per request would write eighty rows a minute; doing it
        // never would make the feature unaccountable (ADR-0069).
        app.MapPost("/api/auth/impersonate", async (
            StartImpersonationRequest req, ClaimsPrincipal user, ActorResolver actors,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            // The real person, deliberately: switching straight from one lens to another is
            // ordinary, and the permission for the second one belongs to the administrator.
            var actorId = await actors.RequireRealActorAsync(user, ct);
            var actor = await db.People.AsNoTracking().FirstAsync(p => p.Id == actorId, ct);

            var subject = await db.People.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == req.PersonId, ct);
            if (subject is null)
                return Results.NotFound(new NotFoundResponse("PERSON_NOT_FOUND", req.PersonId));

            if (subject.Id == actorId)
            {
                return Results.BadRequest(new ErrorResponse(
                    "IMPERSONATION_SELF", "You are already yourself."));
            }

            var own = await GrantsOfAsync(db, actorId, ct);
            var theirs = await GrantsOfAsync(db, subject.Id, ct);

            if (!Impersonation.MayImpersonate(own, theirs, subject.UnitId))
            {
                return Results.Json(
                    new ErrorResponse("IMPERSONATION_FORBIDDEN",
                        $"You may not act as {subject.DisplayName}. It takes administering "
                        + "their planning unit, and holding any global role they hold."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var now = DateTimeOffset.UtcNow;

            // RecordConfiguration, not RecordPerson: the latter stamps `PersonId`, which is
            // what the *cell* history filters on, and a row with no affected dates matches
            // every day — so one lens put "acted as" onto every cell of that person's year.
            // Opening a lens is not something that happened to a day.
            db.RecordConfiguration(HistoryAction.Updated, subject.Id,
                $"{actor.DisplayName} started acting as {subject.DisplayName}",
                null, actorId, HistoryEntityType.Person);

            // The subject is told, because being acted as is a thing that happened to them
            // and nobody else would ever mention it. In-app only: the row *is* the inbox,
            // and external channels follow the matrix like every other kind (ADR-0064).
            await db.NotifyAsync(
                [subject.Id],
                NotificationKind.Impersonated,
                "An administrator is acting as you",
                $"{actor.DisplayName} started acting as you in shift-o-mator, with your roles "
                + "and on your rows. Anything changed while they do carries both names in the "
                + "history.",
                "person", actor.Id, now, ct);

            await db.SaveChangesAsync(ct);

            return Results.Ok(new ImpersonatorSummary(subject.Id, subject.DisplayName));
        })
        .WithName("StartImpersonation")
        .Produces<ImpersonatorSummary>()
        .Produces<ErrorResponse>(StatusCodes.Status403Forbidden)
        .Produces<NotFoundResponse>(StatusCodes.Status404NotFound)
        .RequireAuthorization(AuthPolicies.Authenticated);
    }

    private static async Task<List<Impersonation.Grant>> GrantsOfAsync(
        ShiftOMatorDbContext db, string personId, CancellationToken ct) =>
        [.. (await db.RoleAssignments.AsNoTracking()
                .Where(r => r.PersonId == personId)
                .Select(r => new { r.Role, r.UnitId })
                .ToListAsync(ct))
            .Select(r => new Impersonation.Grant(r.Role, r.UnitId))];

    /// <summary>Whether the lens is worth offering at all. Whether it may be opened over a
    /// <em>particular</em> person is answered by the POST, which knows who.</summary>
    private static async Task<bool> CanImpersonateAsync(
        ShiftOMatorDbContext db, ClaimsPrincipal user, CancellationToken ct)
    {
        if (user.ImpersonatorOrNull() is { } realId)
            return (await GrantsOfAsync(db, realId, ct)).Any(g => g.Role == AppRole.Admin);

        return user.HasAnywhere(AppRole.Admin);
    }
}
