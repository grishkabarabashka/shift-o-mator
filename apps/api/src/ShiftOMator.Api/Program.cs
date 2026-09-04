using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using ShiftOMator.Api;
using ShiftOMator.Api.Admin;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Setup;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using ShiftOMator.Infrastructure.Seed;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();

// Self-service (Phase 14) turns a handful of planner writes into ~80 people writing
// daily; a 500 with no log line and no correlation id is not diagnosable at that rate.
builder.Services.AddHttpContextAccessor();

// Only the holiday import uses this, and only against a host on the `AllowedCalendarHost`
// allowlist (ADR-0063 shape — a row, not configuration; see Settings → Maintenance). The
// short timeout is deliberate: an admin is watching a preview load, and a calendar host
// that is slow should say so rather than hold a request open.
builder.Services.AddHttpClient("calendar", client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
    client.DefaultRequestHeaders.Add("User-Agent", "shift-o-mator/1.0");
});

var connectionString = builder.Configuration.GetConnectionString("Schedule")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Schedule");
builder.Services.AddInfrastructure(connectionString);

// NOTE: prose insights over the plan (/api/insights/*). The API key may be missing —
// the service knows this and returns 503 AI_NOT_CONFIGURED instead of crashing the
// rest of the app.
builder.Services.AddSingleton(ShiftOMator.Api.Insights.ChatModel.FromConfiguration(builder.Configuration));
builder.Services.AddScoped<ShiftOMator.Api.Insights.GapSummaryService>();
builder.Services.AddScoped<ShiftOMator.Api.Insights.CandidateExplanationService>();

// Auth seam (Phase 4): Stub mode issues a fixed identity with no token validation, for
// local dev/demo. Switching to a real IdP later (e.g. "EntraId") only adds a branch
// here — every endpoint already enforces policies against ShiftOMator.Domain.AppRole.
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.SectionName));

// Moved to SystemSetup.DirectoryRoles (ADR-0063), and refused rather than ignored here.
// A settings key that silently does nothing is how Auth:StubRole made everybody a Planner
// and nobody an Admin — the same mistake costs one `if` to prevent.
if (builder.Configuration["Auth:DirectoryRoles"] is not null)
{
    throw new InvalidOperationException(
        "Auth:DirectoryRoles has moved out of configuration (ADR-0063). It is now a row — "
        + "toggle it in the setup wizard or on Settings -> Roles — so remove the setting.");
}
var authMode = builder.Configuration[$"{AuthOptions.SectionName}:Mode"] ?? "Stub";

var authenticationBuilder = builder.Services.AddAuthentication(
    authMode == "Stub" ? StubAuthenticationHandler.SchemeName : JwtBearerDefaults.AuthenticationScheme);

if (authMode == "Stub")
{
    authenticationBuilder.AddScheme<StubAuthenticationSchemeOptions, StubAuthenticationHandler>(
        StubAuthenticationHandler.SchemeName,
        options =>
        {
            // `StubRole` is a role **override**, and it must default to empty. It used to
            // default to "Planner" here *and* in appsettings.json, so the override was
            // always on: nobody was ever an Admin or an Approver, Settings never appeared,
            // no Approve button ever rendered, and switching person changed who you were
            // but not what you could do. Empty means "use the grants stored against this
            // person", which is the realistic path and the only one that exercises
            // RoleAssignment at all (ADR-0051).
            options.Role = builder.Configuration[$"{AuthOptions.SectionName}:StubRole"] ?? string.Empty;
            options.PersonId = builder.Configuration[$"{AuthOptions.SectionName}:StubPersonId"] ?? string.Empty;
        });
}
else
{
    // Real deployment target (ADR: stubbed auth with a real policy surface): bind
    // Authority/Audience/etc. from Auth:Jwt once an Entra ID app registration exists.
    authenticationBuilder.AddJwtBearer(options =>
    {
        builder.Configuration.GetSection($"{AuthOptions.SectionName}:Jwt").Bind(options);

        // Entra puts the audience in one of two shapes, and which one arrives is decided
        // by the app registration's `requestedAccessTokenVersion` — not by anything the
        // client asks for and not by anything configured here. A v1.0 token carries the
        // Application ID URI (`api://<app-id>`); a v2.0 token carries the bare
        // application id. Accepting both means whichever the operator pasted into
        // Auth:Jwt:Audience is right, because they identify the same registration and
        // there is no third party either could be confused with.
        //
        // Worth the four lines because the failure is so badly signposted: the challenge
        // reads `The audience '(null)' is invalid`, where the `(null)` is the *token's*
        // audience as the exception failed to record it — so the message points at the
        // token when the mismatch is with our own configured string.
        const string uriPrefix = "api://";
        if (!string.IsNullOrWhiteSpace(options.Audience))
        {
            var configured = options.Audience;
            var alternate = configured.StartsWith(uriPrefix, StringComparison.OrdinalIgnoreCase)
                ? configured[uriPrefix.Length..]
                : uriPrefix + configured;
            options.TokenValidationParameters.ValidAudiences = [configured, alternate];
        }
    });
}

// Scoped, because it caches the resolved person for the lifetime of one request and
// reads the roster to verify the claim (ADR-0039).
builder.Services.AddScoped<ActorResolver>();

// Grants live in the database, not in the token: they are scoped to planning units, a
// concept no identity provider knows about (ADR-0051).
builder.Services.AddSingleton<Microsoft.AspNetCore.Authentication.IClaimsTransformation, RoleClaimsTransformation>();

builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, RoleAuthorizationHandler>();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthPolicies.Authenticated, p => p.Requirements.Add(new RoleRequirement(AppRole.Viewer)))
    .AddPolicy(AuthPolicies.PlannerSomewhere, p => p.Requirements.Add(new RoleRequirement(AppRole.Planner)))
    .AddPolicy(AuthPolicies.ApproverSomewhere, p => p.Requirements.Add(new RoleRequirement(AppRole.Approver)))
    .AddPolicy(AuthPolicies.AdminSomewhere, p => p.Requirements.Add(new RoleRequirement(AppRole.Admin)));

// The client is a separate origin (Vite dev server, and any deployed SPA
// origin) — without this, every fetch() from src/api/client.ts is blocked by
// the browser before it reaches auth/routing at all. Origins are configured
// (Cors:AllowedOrigins), not wildcarded, since the app sends no cookies but
// does send whatever bearer token Auth:Mode=EntraId will add later.
const string ClientCorsPolicy = "Client";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
    options.AddPolicy(ClientCorsPolicy, policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        // The dev identity switcher sends X-Debug-*; without this the browser strips
        // them from cross-origin requests before they reach the stub handler.
        .WithExposedHeaders(RequestCorrelationMiddleware.HeaderName)));

var app = builder.Build();

// One place that turns an unhandled exception into a typed body instead of a bare 500
// with a stack trace in dev and nothing at all in production.
app.UseExceptionHandler(ExceptionHandling.Handler);
app.UseMiddleware<RequestCorrelationMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    // Browsable API reference over the same document api:schema generates
    // from (http://localhost:5106/scalar) — Stub auth (Program.cs, default
    // Auth:Mode) authenticates every request already, so "Try it" works
    // with no token to paste in.
    app.MapScalarApiReference();
}

app.UseHttpsRedirection();

app.UseCors(ClientCorsPolicy);

// Before authentication: a blocked request needs no identity to be told "not yet", and
// deferring this would mean validating a bearer token on every request while the system
// has nothing behind it to authenticate for (ADR-0059).
app.UseMiddleware<ShiftOMator.Api.Setup.SetupGateMiddleware>();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (ScheduleDbContext db) =>
    await db.Database.CanConnectAsync() ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));

app.MapSetupEndpoints();
app.MapReferenceEndpoints();
app.MapAuthEndpoints();
app.MapMeEndpoints();
app.MapScheduleEndpoints();
app.MapDraftsEndpoints();
app.MapSuggestEndpoints();
app.MapInsightsEndpoints();
app.MapAcknowledgementsEndpoints();
app.MapHistoryEndpoints();
app.MapCellHistoryEndpoints();
app.MapPeopleEndpoints();
app.MapPresenceEndpoints();
app.MapAbsenceEndpoints();
app.MapRequestsEndpoints();

// Phase 6: full CRUD administration, gated behind AuthPolicies.AdminSomewhere.
app.MapLocationsAdminEndpoints();
app.MapHolidaysAdminEndpoints();
app.MapHolidayImportEndpoints();
app.MapAllowedCalendarHostsAdminEndpoints();
app.MapUnitsAdminEndpoints();
app.MapRoleAssignmentsAdminEndpoints();
app.MapEventTypesAdminEndpoints();
app.MapPresenceTypesAdminEndpoints();
app.MapAbsenceCapacityRulesAdminEndpoints();
app.MapShiftsAdminEndpoints();
app.MapDayConfigurationsAdminEndpoints();
app.MapPeopleAdminEndpoints();
app.MapMaintenanceAdminEndpoints();
app.MapNotificationsAdminEndpoints();

// `--reset-db` drops the database and builds it again from the single migration.
//
// WHY it exists: the schema is one regenerated `InitialCreate` while there is no
// production data (CLAUDE.md), so every schema change orphans the existing database. The
// recovery was a hand-written sqlcmd line, looked up each time, and getting it wrong left
// a half-migrated database that failed later and further away from the cause.
//
// Deliberately a flag and not a default: it destroys everything, and "the app wiped my
// data on start" must never be something that just happens.
var resetDb = args.Contains("--reset-db");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();

    if (resetDb)
    {
        app.Logger.LogWarning(
            "--reset-db: dropping database {Database} and rebuilding it from scratch.",
            db.Database.GetDbConnection().Database);
        await db.Database.EnsureDeletedAsync();
    }
    else
    {
        await EnsureSchemaIsReconcilableAsync(db);
    }

    await db.Database.MigrateAsync();

    // Reference data only — event types, presence types, request types, and the role
    // grants derived from whatever roster already exists. What a fresh database starts as
    // beyond that is answered once, by whoever opens the app first, on the setup wizard
    // (ADR-0059) — this call writes nothing on a database the wizard has not reached yet.
    await FixtureSeeder.SeedAsync(db);
}

/// <summary>
/// Refuses to start against a database built by a migration this build no longer has.
///
/// WHY this check exists: while there is no production data the schema is kept as a single
/// `InitialCreate` that is **regenerated** rather than appended to. The cost is that every
/// existing database becomes unreconcilable the moment it is regenerated — EF sees a
/// migration id it does not recognise, decides nothing has been applied, and tries to
/// CREATE TABLE over tables that are already there. The error it raises is
/// "There is already an object named 'Absences' in the database", which says nothing about
/// the actual cause and cost several confused restarts before it was named.
///
/// Once real data exists this stops being acceptable and migrations become incremental
/// again — at which point this check should start passing on its own and can go.
/// </summary>
static async Task EnsureSchemaIsReconcilableAsync(ScheduleDbContext db)
{
    if (!await db.Database.CanConnectAsync()) return;

    var known = db.Database.GetMigrations().ToHashSet();
    var applied = await db.Database.GetAppliedMigrationsAsync();
    var unknown = applied.Where(id => !known.Contains(id)).ToList();
    if (unknown.Count == 0) return;

    var name = db.Database.GetDbConnection().Database;
    throw new InvalidOperationException(
        $"""
        Database '{name}' was created by migration(s) this build does not have
        ({string.Join(", ", unknown)}), so its schema cannot be brought up to date.

        The schema is a single regenerated InitialCreate while there is no production data
        (see CLAUDE.md), so the fix is to drop the database and let it be recreated:

          sqlcmd -S "(localdb)\MSSQLLocalDB" -Q "ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];"

        Everything in it is seed and demo data; nothing entered by hand survives there yet.
        """);
}

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program;
