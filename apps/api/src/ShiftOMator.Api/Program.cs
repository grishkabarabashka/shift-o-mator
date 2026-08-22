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

var connectionString = builder.Configuration.GetConnectionString("Schedule")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Schedule");
builder.Services.AddInfrastructure(connectionString);

// Пояснения поверх плана (/api/insights/*). Ключа может не быть — сервис это знает и
// отвечает 503 AI_NOT_CONFIGURED, не роняя остальное приложение.
builder.Services.AddSingleton(ShiftOMator.Api.Insights.ChatModel.FromConfiguration(builder.Configuration));
builder.Services.AddScoped<ShiftOMator.Api.Insights.GapSummaryService>();

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
        options => options.Role = builder.Configuration[$"{AuthOptions.SectionName}:StubRole"] ?? "Planner");
}
else
{
    // Real deployment target (ADR: stubbed auth with a real policy surface): bind
    // Authority/Audience/etc. from Auth:Jwt once an Entra ID app registration exists.
    authenticationBuilder.AddJwtBearer(options =>
        builder.Configuration.GetSection($"{AuthOptions.SectionName}:Jwt").Bind(options));
}

builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, MinimumRoleAuthorizationHandler>();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthPolicies.ViewerOrAbove, p => p.Requirements.Add(new MinimumRoleRequirement(AppRole.Viewer)))
    .AddPolicy(AuthPolicies.PlannerOrAbove, p => p.Requirements.Add(new MinimumRoleRequirement(AppRole.Planner)))
    .AddPolicy(AuthPolicies.AdminOnly, p => p.Requirements.Add(new MinimumRoleRequirement(AppRole.Admin)));

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
        .AllowAnyMethod()));

var app = builder.Build();

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
app.MapScheduleEndpoints();
app.MapDraftsEndpoints();
app.MapSuggestEndpoints();
app.MapInsightsEndpoints();
app.MapAcknowledgementsEndpoints();
app.MapHistoryEndpoints();
app.MapPeopleEndpoints();

// Phase 6: full CRUD administration, gated behind AuthPolicies.AdminOnly.
app.MapLocationsAdminEndpoints();
app.MapHolidaysAdminEndpoints();
app.MapUnitsAdminEndpoints();
app.MapAbsenceCapacityRulesAdminEndpoints();
app.MapShiftsAdminEndpoints();
app.MapDayConfigurationsAdminEndpoints();
app.MapPeopleAdminEndpoints();

// Справочные данные — всегда (защищено идемпотентной проверкой в FixtureSeeder).
// Демо-план (назначения/отпуска/отгулы) — только по явному флагу: первый прод не
// должен подниматься с выдуманными сменами.
var includeDemoData = args.Contains("--seed-demo") || builder.Configuration.GetValue<bool>("Seed:IncludeDemoData");
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
    await db.Database.MigrateAsync();
    await FixtureSeeder.SeedAsync(db, includeDemoData);
}

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program;
