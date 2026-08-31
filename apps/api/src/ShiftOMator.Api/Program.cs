using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using ShiftOMator.Api;
using ShiftOMator.Api.Admin;
using ShiftOMator.Api.Auth;
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

// Only the holiday import uses this, and only against Holidays:AllowedCalendarHosts. The
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
        builder.Configuration.GetSection($"{AuthOptions.SectionName}:Jwt").Bind(options));
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

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (ScheduleDbContext db) =>
    await db.Database.CanConnectAsync() ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));

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
app.MapUnitsAdminEndpoints();
app.MapRoleAssignmentsAdminEndpoints();
app.MapEventTypesAdminEndpoints();
app.MapPresenceTypesAdminEndpoints();
app.MapAbsenceCapacityRulesAdminEndpoints();
app.MapShiftsAdminEndpoints();
app.MapDayConfigurationsAdminEndpoints();
app.MapPeopleAdminEndpoints();

// NOTE: reference data is always seeded (guarded by an idempotency check in
// FixtureSeeder). The demo plan (assignments/absences/comp days) only goes in behind
// an explicit flag — the first production run must not come up with made-up shifts.
var includeDemoData = args.Contains("--seed-demo") || builder.Configuration.GetValue<bool>("Seed:IncludeDemoData");

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

    // Applied only while no person has an email at all, so it is inert on a running
    // system — see AuthOptions.BootstrapAdminEmail and ADR-0058. Logged either way,
    // because "why can nobody sign in" is otherwise answered by reading the seeder.
    var bootstrapAdminEmail = builder.Configuration[$"{AuthOptions.SectionName}:BootstrapAdminEmail"];
    var linkedBefore = await db.People.AnyAsync(p => p.Email != null);

    await FixtureSeeder.SeedAsync(db, includeDemoData, bootstrapAdminEmail);

    if (!string.IsNullOrWhiteSpace(bootstrapAdminEmail))
    {
        if (linkedBefore)
        {
            app.Logger.LogInformation(
                "Auth:BootstrapAdminEmail is set but ignored: somebody is already linked. "
                + "Sign-in accounts are managed on Settings → People.");
        }
        else
        {
            var linked = await db.People.AsNoTracking()
                .Where(p => p.Email != null)
                .Select(p => new { p.Id, p.DisplayName })
                .FirstOrDefaultAsync();

            if (linked is null)
            {
                app.Logger.LogWarning(
                    "Auth:BootstrapAdminEmail is set but nobody was linked — no person holds a "
                    + "global Admin grant to attach it to.");
            }
            else
            {
                app.Logger.LogWarning(
                    "Auth:BootstrapAdminEmail linked {Email} to {Person} ({PersonId}), who holds the "
                    + "global Admin grant. Remove the setting once other people are linked.",
                    bootstrapAdminEmail, linked.DisplayName, linked.Id);
            }
        }
    }
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
