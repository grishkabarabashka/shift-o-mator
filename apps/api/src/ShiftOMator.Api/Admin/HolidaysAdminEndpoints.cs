using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Admin;

/// <summary>Holiday: not versioned, but has a real Id now (Phase 1 model fix) so it can
/// actually be edited/deleted through CRUD instead of matched by date+name.</summary>
public static class HolidaysAdminEndpoints
{
    public static void MapHolidaysAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/holidays").RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.Holidays.AsNoTracking().OrderBy(h => h.Date).ToListAsync(ct)))
            .Produces<IReadOnlyList<Holiday>>();

        group.MapPost("/", async (HolidayRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var holiday = new Holiday
            {
                Id = $"hol-{Guid.NewGuid():N}",
                Date = req.Date,
                Name = req.Name,
                LocationIds = req.LocationIds,
                IsFullDay = req.IsFullDay,
            };
            db.Holidays.Add(holiday);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/holidays/{holiday.Id}", holiday);
        })
        .Produces<Holiday>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}", async (string id, HolidayRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = Validate(req);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var holiday = await db.Holidays.FirstOrDefaultAsync(h => h.Id == id, ct);
            if (holiday is null) return AdminValidation.NotFound("holiday", id);

            holiday.Date = req.Date;
            holiday.Name = req.Name;
            holiday.LocationIds = req.LocationIds;
            holiday.IsFullDay = req.IsFullDay;
            await db.SaveChangesAsync(ct);
            return Results.Ok(holiday);
        })
        .Produces<Holiday>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapDelete("/{id}", async (string id, ScheduleDbContext db, CancellationToken ct) =>
        {
            var holiday = await db.Holidays.FirstOrDefaultAsync(h => h.Id == id, ct);
            if (holiday is null) return AdminValidation.NotFound("holiday", id);

            db.Holidays.Remove(holiday);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static AdminValidation Validate(HolidayRequest req)
    {
        var v = new AdminValidation();
        v.Require(nameof(req.Name), req.Name);
        v.Check(nameof(req.LocationIds), req.LocationIds is { Count: > 0 }, "must include at least one location.");
        return v;
    }
}
