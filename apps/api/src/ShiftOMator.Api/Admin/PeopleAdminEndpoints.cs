using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// Person identity/roster fields (name, unit, location, default shift, org
/// category, active/included flags) — distinct from <c>PUT /api/people/{id}</c>
/// (Phase 5, kept as-is), which owns eligibility/preferences/target shares, the slice
/// the People-page profile editor already wrote against the in-memory repository.
/// Splitting them avoids one endpoint owning two different callers' concerns.
/// </summary>
public static class PeopleAdminEndpoints
{
    public record PersonRequest(
        string DisplayName, string Initials, string? EmployeeId, string UnitId,
        string LocationId, OrgCategory OrgCategory, bool IsActive, bool IsIncluded);

    public static void MapPeopleAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/people").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.People.AsNoTracking().Include(p => p.Eligibility).OrderBy(p => p.DisplayName).ToListAsync(ct)));

        group.MapPost("/", async (PersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var person = new Person
            {
                Id = $"p-{Guid.NewGuid():N}",
                DisplayName = req.DisplayName,
                Initials = req.Initials,
                EmployeeId = req.EmployeeId,
                UnitId = req.UnitId,
                LocationId = req.LocationId,
                OrgCategory = req.OrgCategory,
                IsActive = req.IsActive,
                IsIncluded = req.IsIncluded,
                CalendarToken = Guid.NewGuid().ToString("N"),
            };
            db.People.Add(person);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/people/{person.Id}", person);
        });

        group.MapPut("/{id}", async (string id, PersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return AdminValidation.NotFound("person", id);

            person.DisplayName = req.DisplayName;
            person.Initials = req.Initials;
            person.EmployeeId = req.EmployeeId;
            person.UnitId = req.UnitId;
            person.LocationId = req.LocationId;
            person.OrgCategory = req.OrgCategory;
            person.IsActive = req.IsActive;
            person.IsIncluded = req.IsIncluded;
            await db.SaveChangesAsync(ct);
            return Results.Ok(person);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return AdminValidation.NotFound("person", id);

            var hasHistory = await db.Assignments.AnyAsync(a => a.PersonId == id, ct)
                || await db.Absences.AnyAsync(a => a.PersonId == id, ct)
                || await db.CompDayEntries.AnyAsync(c => c.PersonId == id, ct);
            if (hasHistory)
                return AdminValidation.Conflict(
                    "PERSON_HAS_HISTORY",
                    $"Person {id} has assignments, absences or comp days — set isActive=false instead of deleting.");

            db.People.Remove(person);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<AdminValidation> ValidateAsync(PersonRequest req, ScheduleDbContext db, CancellationToken ct)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.DisplayName), req.DisplayName);
        v.Require(nameof(req.Initials), req.Initials);
        v.Require(nameof(req.UnitId), req.UnitId);
        v.Require(nameof(req.LocationId), req.LocationId);

        if (!string.IsNullOrWhiteSpace(req.UnitId) && !await db.PlanningUnits.AnyAsync(u => u.Id == req.UnitId, ct))
            v.Add(nameof(req.UnitId), $"Unit {req.UnitId} does not exist.");
        if (!string.IsNullOrWhiteSpace(req.LocationId) && !await db.Locations.AnyAsync(l => l.Id == req.LocationId, ct))
            v.Add(nameof(req.LocationId), $"Location {req.LocationId} does not exist.");

        return v;
    }
}
