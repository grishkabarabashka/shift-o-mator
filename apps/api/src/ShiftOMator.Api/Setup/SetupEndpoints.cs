using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Auth;
using ShiftOMator.Api.Contracts.Setup;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Setup;

namespace ShiftOMator.Api.Setup;

/// <summary>
/// The setup wizard's own two endpoints (ADR-0059). Everything else a fresh system needs
/// — reference data — is topped up unconditionally at startup and was never gated on
/// this; these two are the only endpoints that write while the caller holds no role at
/// all, which is why each checks <see cref="ShiftOMator.Domain.SystemSetup"/> itself
/// rather than trusting the gate that gets a request this far.
/// </summary>
public static class SetupEndpoints
{
    public static void MapSetupEndpoints(this WebApplication app)
    {
        // Anonymous and deliberately uninformative: a fingerprint of an unconfigured
        // system is not worth handing to a caller who has not signed in yet, and the
        // client needs an answer before `AuthProvider` has one (it sits above it, exactly
        // like the calendar feed route).
        app.MapGet("/api/setup/state", async (IOptions<AuthOptions> auth, ShiftOMatorDbContext db, CancellationToken ct) =>
            Results.Ok(new SetupStateResponse(
                await SetupService.IsRequiredAsync(db, ct),
                string.Equals(auth.Value.Mode, "Stub", StringComparison.OrdinalIgnoreCase))))
            .WithName("GetSetupState")
            .AllowAnonymous()
            .Produces<SetupStateResponse>();

        // `AuthPolicies.Authenticated` only asks for a valid signed-in principal — every
        // principal is a Viewer (`RoleClaimsTransformation`), mapped to a `Person` or not.
        // It must not go through `ActorResolver`: that throws for an unmapped principal,
        // which is the *expected* state of every caller who reaches this endpoint.
        app.MapPost("/api/setup", async (
            SetupRequest req, ClaimsPrincipal user, IOptions<AuthOptions> auth,
            ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            if (!await SetupService.IsRequiredAsync(db, ct))
                return Results.Conflict(new ErrorResponse("SETUP_COMPLETE", "This system has already been set up."));

            var isStub = string.Equals(auth.Value.Mode, "Stub", StringComparison.OrdinalIgnoreCase);

            try
            {
                if (req.Preset == SetupPreset.Bare)
                {
                    if (req.Bare is null)
                        return Results.BadRequest(new ErrorResponse("MISSING_BARE_FIELDS", "The Bare preset needs its fields."));

                    // Outside Stub mode the caller's own identity is taken from their
                    // token, never from the body — a typo here would be a system whose
                    // only administrator cannot sign back in. Stub mode has no claims to
                    // read, so it is the one path that trusts what was typed.
                    var displayName = isStub ? req.Bare.DisplayName : user.DisplayNameOrNull();
                    var email = isStub ? req.Bare.Email : user.EmailOrNull();

                    if (string.IsNullOrWhiteSpace(displayName))
                        return Results.BadRequest(new ErrorResponse("MISSING_DISPLAY_NAME", "No display name available."));

                    if (!isStub && string.IsNullOrWhiteSpace(email))
                        return Results.BadRequest(new ErrorResponse("MISSING_EMAIL", "The signed-in token carries no email."));

                    var validation = ValidateBare(req.Bare);
                    if (validation.ToBadRequestOrNull() is { } bad) return bad;

                    var person = await SetupService.CompleteBareAsync(
                        db, req.Bare.LocationName, req.Bare.TimeZone, req.Bare.HolidayCalendarKey,
                        req.Bare.UnitName, req.Bare.UnitKind, displayName, email,
                        req.Bare.Roles, req.DirectoryRoles, ct);

                    db.RecordConfiguration(HistoryAction.Created, "system-setup",
                        $"System set up (Bare) by {person.DisplayName}", null, person.Id);
                    await db.SaveChangesAsync(ct);

                    return Results.Created("/api/setup", new SetupResponse(SetupPreset.Bare, person.Id, person.DisplayName));
                }
                else
                {
                    var callerEmail = isStub ? null : user.EmailOrNull();
                    var linked = await SetupService.CompleteDemoAsync(
                        db, callerEmail, req.DirectoryRoles, ct);

                    db.RecordConfiguration(HistoryAction.Created, "system-setup",
                        linked is null
                            ? "System set up (Demo)"
                            : $"System set up (Demo) by {linked.DisplayName}",
                        null, linked?.Id ?? "system");
                    await db.SaveChangesAsync(ct);

                    return Results.Created("/api/setup", new SetupResponse(SetupPreset.Demo, linked?.Id, linked?.DisplayName));
                }
            }
            catch (SetupAlreadyCompleteException)
            {
                // The check above and the write below are not atomic against a second
                // request racing in between; the fixed primary key on `SystemSetup` is
                // the real guard, and this is where its failure surfaces.
                return Results.Conflict(new ErrorResponse("SETUP_COMPLETE", "This system has already been set up."));
            }
        })
        .WithName("CompleteSetup")
        .Produces<SetupResponse>(StatusCodes.Status201Created)
        .Produces<ErrorResponse>(StatusCodes.Status400BadRequest)
        .Produces<ErrorResponse>(StatusCodes.Status409Conflict)
        .RequireAuthorization(AuthPolicies.Authenticated);

        app.MapGet("/api/setup/diagnostics", DiagnosticsAsync)
            .WithName("GetSetupDiagnostics")
            .Produces<SetupDiagnosticsResponse>()
            .RequireAuthorization(AuthPolicies.Authenticated);
    }

    /// <summary>
    /// What this system is, who the caller is in it, and what it still lacks.
    ///
    /// Signed in but not necessarily *anybody*: the caller who most needs this is the one
    /// whose token matches no `Person`, so it must not go through `ActorResolver`, which
    /// throws for exactly that case. `AuthPolicies.Authenticated` asks only for a valid
    /// principal, and every principal is a Viewer.
    ///
    /// Not anonymous, though — unlike `/api/setup/state`. This names the authority, the
    /// audience and the shape of the roster, which is a fingerprint of the deployment and
    /// not something to hand to a caller who has not signed in.
    /// </summary>
    private static async Task<IResult> DiagnosticsAsync(
        ClaimsPrincipal user, IOptions<AuthOptions> auth, IConfiguration configuration,
        Insights.ChatModel model, ShiftOMatorDbContext db, CancellationToken ct)
    {
        var tokenEmail = user.EmailOrNull()?.Trim().ToLowerInvariant();

        // Resolved the same way `ActorResolver` does — by email, and only by email
        // (ADR-0058) — but returning null instead of throwing, because "matches nobody" is
        // the answer this endpoint exists to give rather than an error it should raise.
        var person = string.IsNullOrWhiteSpace(tokenEmail)
            ? null
            : await db.People.AsNoTracking().FirstOrDefaultAsync(p => p.Email == tokenEmail, ct);

        // Off the claims, not off the database: this is what the caller is *acting with*
        // right now, which in Stub mode includes a debug override and, with directory
        // roles on, includes what the token brought. Reading `RoleAssignments` instead
        // would quietly answer a different question.
        var grants = user.FindAll(Capabilities.RoleClaim)
            .Select(claim => claim.Value.Split('|', 2))
            .Where(parts => parts.Length == 2 && Enum.TryParse<AppRole>(parts[0], true, out _))
            .Select(parts => new RoleGrant(
                Enum.Parse<AppRole>(parts[0], ignoreCase: true),
                parts[1].Length == 0 ? null : parts[1]))
            .ToList();

        var setup = await db.SystemSetups.AsNoTracking().FirstOrDefaultAsync(ct);

        return Results.Ok(new SetupDiagnosticsResponse(
            new AuthDiagnostics(
                auth.Value.Mode,
                configuration["Auth:Jwt:Authority"],
                configuration["Auth:Jwt:Audience"],
                setup?.DirectoryRoles ?? false),
            new CallerDiagnostics(
                person?.Id,
                person?.DisplayName ?? user.DisplayNameOrNull(),
                tokenEmail,
                person is not null,
                grants),
            new ContentDiagnostics(
                await db.People.CountAsync(p => p.IsActive, ct),
                await db.People.CountAsync(p => p.IsActive && p.IsIncluded, ct),
                await db.PlanningUnits.CountAsync(ct),
                await db.Shifts.CountAsync(ct),
                await db.DayConfigurations.CountAsync(ct)),
            new AiDiagnostics(
                configuration["Ai:Provider"] ?? "none",
                model.Configured)));
    }

    private static Admin.AdminValidation ValidateBare(BareSetupRequest req)
    {
        var v = new Admin.AdminValidation();
        v.Require(nameof(req.LocationName), req.LocationName);
        v.Require(nameof(req.TimeZone), req.TimeZone);
        v.Require(nameof(req.HolidayCalendarKey), req.HolidayCalendarKey);
        v.Require(nameof(req.UnitName), req.UnitName);
        return v;
    }
}
