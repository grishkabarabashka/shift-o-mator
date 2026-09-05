using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Location: calendar + display timezone only (ADR-0002). Fully in-place —
/// nothing here is effective-dated.</summary>
public static class LocationsAdminEndpoints
{
    public static void MapLocationsAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/locations").RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ShiftOMatorDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Locations.AsNoTracking().OrderBy(l => l.Id).ToListAsync(ct)))
            .Produces<IReadOnlyList<Location>>();

        group.MapGet("/{id}", async (string id, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var location = await db.Locations.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
            return location is null ? AdminValidation.NotFound("location", id) : Results.Ok(location);
        })
        .Produces<Location>()
        .Produces(StatusCodes.Status404NotFound);

        group.MapPost("/", async (LocationRequest req, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var location = new Location
            {
                Id = $"loc-{Guid.NewGuid():N}",
                Name = req.Name,
                Country = req.Country,
                TimeZone = req.TimeZone,
                HolidayCalendarKey = req.HolidayCalendarKey,
                WeekendDays = req.WeekendDays,
            };
            db.Locations.Add(location);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/locations/{location.Id}", location);
        })
        .Produces<Location>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}", async (string id, LocationRequest req, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct);
            if (location is null) return AdminValidation.NotFound("location", id);

            location.Name = req.Name;
            location.Country = req.Country;
            location.TimeZone = req.TimeZone;
            location.HolidayCalendarKey = req.HolidayCalendarKey;
            location.WeekendDays = req.WeekendDays;
            await db.SaveChangesAsync(ct);
            return Results.Ok(location);
        })
        .Produces<Location>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapDelete("/{id}", async (string id, ShiftOMatorDbContext db, CancellationToken ct) =>
        {
            var location = await db.Locations.FirstOrDefaultAsync(l => l.Id == id, ct);
            if (location is null) return AdminValidation.NotFound("location", id);

            // LocationIds is a JSON-converted list column — EF can't translate
            // `.Contains` on it to SQL, so the unit side of this check is done
            // in memory over the (small, 4-row) units table rather than server-side.
            var usedByPerson = await db.People.AnyAsync(p => p.LocationId == id, ct);
            var units = await db.PlanningUnits.AsNoTracking().Select(u => new { u.PrimaryLocationId, u.LocationIds }).ToListAsync(ct);
            var usedByUnit = units.Any(u => u.PrimaryLocationId == id || u.LocationIds.Contains(id));
            if (usedByPerson || usedByUnit) return AdminValidation.Conflict("LOCATION_IN_USE", $"Location {id} is referenced by a unit or person.");

            db.Locations.Remove(location);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status409Conflict);
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
