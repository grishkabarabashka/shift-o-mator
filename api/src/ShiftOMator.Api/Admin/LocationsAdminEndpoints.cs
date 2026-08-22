using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Location: calendar + display timezone only (ADR-0002). Fully in-place —
/// nothing here is effective-dated.</summary>
public static class LocationsAdminEndpoints
{
    public record LocationRequest(string Name, string TimeZone, string HolidayCalendarKey, List<IsoWeekday> WeekendDays);

    public static void MapLocationsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/locations").RequireAuthorization(AuthPolicies.AdminOnly);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Locations.AsNoTracking().OrderBy(l => l.Id).ToListAsync(ct)));

        group.MapGet("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var location = await db.Locations.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
            return location is null ? AdminValidation.NotFound("location", id) : Results.Ok(location);
        });

        group.MapPost("/", async (LocationRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var location = new Location
            {
                Id = $"loc-{Guid.NewGuid():N}",
                Name = req.Name,
                TimeZone = req.TimeZone,
                HolidayCalendarKey = req.HolidayCalendarKey,
                WeekendDays = req.WeekendDays,
            };
            db.Locations.Add(location);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/locations/{location.Id}", location);
        });

        group.MapPut("/{id}", async (string id, LocationRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct);
            if (location is null) return AdminValidation.NotFound("location", id);

            location.Name = req.Name;
            location.TimeZone = req.TimeZone;
            location.HolidayCalendarKey = req.HolidayCalendarKey;
            location.WeekendDays = req.WeekendDays;
            await db.SaveChangesAsync(ct);
            return Results.Ok(location);
        });

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct);
            if (location is null) return AdminValidation.NotFound("location", id);

            // LocationIds is a JSON-converted list column — EF can't translate
            // `.Contains` on it to SQL, so the region side of this check is done
            // in memory over the (small, 3-row) regions table rather than server-side.
            var usedByPerson = await db.People.AnyAsync(p => p.LocationId == id, ct);
            var regions = await db.Regions.AsNoTracking().Select(r => new { r.PrimaryLocationId, r.LocationIds }).ToListAsync(ct);
            var usedByRegion = regions.Any(r => r.PrimaryLocationId == id || r.LocationIds.Contains(id));
            if (usedByPerson || usedByRegion) return AdminValidation.Conflict("LOCATION_IN_USE", $"Location {id} is referenced by a region or person.");

            db.Locations.Remove(location);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static AdminValidation Validate(LocationRequest req)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.Name), req.Name);
        v.Require(nameof(req.TimeZone), req.TimeZone);
        v.Require(nameof(req.HolidayCalendarKey), req.HolidayCalendarKey);
        return v;
    }
}
