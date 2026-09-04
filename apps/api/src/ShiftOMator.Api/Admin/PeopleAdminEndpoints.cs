using Microsoft.EntityFrameworkCore;
using ShiftOMator.Api.Auth;
using ShiftOMator.Api.Contracts.Admin;
using ShiftOMator.Api.Contracts.Shared;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;
using System.Security.Claims;

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
    public static void MapPeopleAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin/people").RequireAuthorization(AuthPolicies.AdminSomewhere);

        group.MapGet("/", async (ScheduleDbContext db, CancellationToken ct) =>
            Results.Ok(await db.People.AsNoTracking().Include(p => p.Eligibility).OrderBy(p => p.DisplayName).ToListAsync(ct)))
            .Produces<IReadOnlyList<Person>>();

        group.MapPost("/", async (AdminPersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct, currentId: null);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var person = new Person
            {
                Id = $"p-{Guid.NewGuid():N}",
                DisplayName = req.DisplayName,
                Initials = req.Initials,
                EmployeeId = req.EmployeeId,
                Email = NormalizeEmail(req.Email),
                UnitId = req.UnitId,
                LocationId = req.LocationId,
                OrgCategory = req.OrgCategory,
                IsActive = req.IsActive,
                IsIncluded = req.IsIncluded,
                CalendarToken = Person.NewCalendarToken(),
            };
            db.People.Add(person);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/people/{person.Id}", person);
        })
        .Produces<Person>(StatusCodes.Status201Created)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPut("/{id}", async (string id, AdminPersonRequest req, ScheduleDbContext db, CancellationToken ct) =>
        {
            var validation = await ValidateAsync(req, db, ct, currentId: id);
            if (validation.ToBadRequestOrNull() is { } bad) return bad;

            var person = await db.People.FirstOrDefaultAsync(p => p.Id == id, ct);
            if (person is null) return AdminValidation.NotFound("person", id);

            person.DisplayName = req.DisplayName;
            person.Initials = req.Initials;
            person.EmployeeId = req.EmployeeId;
            person.Email = NormalizeEmail(req.Email);
            person.UnitId = req.UnitId;
            person.LocationId = req.LocationId;
            person.OrgCategory = req.OrgCategory;
            person.IsActive = req.IsActive;
            person.IsIncluded = req.IsIncluded;
            await db.SaveChangesAsync(ct);
            return Results.Ok(person);
        })
        .Produces<Person>()
        .Produces(StatusCodes.Status404NotFound)
        .Produces<ValidationErrorResponse>(StatusCodes.Status400BadRequest);

        group.MapPost("/batch", ApplyBatchAsync)
            .Produces<PeopleBatchResponse>()
            .Produces<PeopleBatchErrorResponse>(StatusCodes.Status400BadRequest);

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
        })
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status404NotFound)
        .Produces(StatusCodes.Status409Conflict);
    }

    /// <summary>
    /// Every pending edit from Settings → People, applied as one unit (ADR-0061).
    ///
    /// WHY this exists when the single-row routes above already work: rows in this table
    /// are not independent. Email and EmployeeId carry filtered unique indexes, so moving
    /// an address from one person to another is two writes that are only valid together —
    /// and the client, saving row by row, could apply the release and then have the claim
    /// rejected. The address was then on nobody, which for Email means the person it
    /// belonged to can no longer sign in (ADR-0058).
    ///
    /// Two things are needed and they are not the same thing:
    ///
    /// - Atomicity, so a rejected op cannot leave an applied one behind. That is the
    ///   transaction.
    /// - Order, because SQL Server checks a unique index per statement, not at commit. A
    ///   transaction alone would still reject the claim before the release — so releases
    ///   go first, and each op validates against the state the ones before it left.
    /// </summary>
    private static async Task<IResult> ApplyBatchAsync(
        PeopleBatchRequest req, ClaimsPrincipal user, ActorResolver actors,
        ScheduleDbContext db, CancellationToken ct)
    {
        if (req.Ops.Count == 0) return Results.Ok(new PeopleBatchResponse([]));

        var actorId = await actors.RequireAsync(user, ct);

        var referenced = req.Ops.Where(o => o.Id is not null).Select(o => o.Id!).ToHashSet();
        var current = await db.People.AsNoTracking()
            .Where(p => referenced.Contains(p.Id))
            .Select(p => new { p.Id, p.Email, p.EmployeeId })
            .ToDictionaryAsync(p => p.Id, ct);

        // A delete frees both of its unique values; an update frees one by blanking it.
        // Anything else may want a value that is still held, so it goes second.
        bool ReleasesAUniqueValue(PeopleBatchOp op)
        {
            if (op.Kind == "delete") return true;
            if (op.Kind != "update" || op.Id is null || op.Person is null) return false;
            if (!current.TryGetValue(op.Id, out var was)) return false;
            return (was.Email is not null && string.IsNullOrWhiteSpace(op.Person.Email))
                || (was.EmployeeId is not null && string.IsNullOrWhiteSpace(op.Person.EmployeeId));
        }

        // Indexed before sorting: an error has to name the op the caller sent, not the
        // position we happened to apply it in.
        var ordered = req.Ops
            .Select((op, index) => (op, index))
            .OrderBy(e => ReleasesAUniqueValue(e.op) ? 0 : 1)
            .ToList();

        var errors = new Dictionary<int, IReadOnlyDictionary<string, IEnumerable<string>>>();
        var results = new List<PeopleBatchResult>();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        foreach (var (op, index) in ordered)
        {
            if (op.Kind == "create" && op.Person is not null)
            {
                var validation = await ValidateAsync(op.Person, db, ct, currentId: null);
                if (validation.HasErrors) { errors[index] = validation.Errors; continue; }

                var created = NewPerson(op.Person);
                db.People.Add(created);
                db.RecordConfiguration(HistoryAction.Created, created.Id,
                    $"Person {created.DisplayName}", created, actorId);
                await db.SaveChangesAsync(ct);
                results.Add(new PeopleBatchResult(index, op.TempId, created.Id));
            }
            else if (op.Kind == "update" && op.Person is not null && op.Id is not null)
            {
                var validation = await ValidateAsync(op.Person, db, ct, currentId: op.Id);
                if (validation.HasErrors) { errors[index] = validation.Errors; continue; }

                var person = await db.People.FirstOrDefaultAsync(p => p.Id == op.Id, ct);
                if (person is null)
                {
                    errors[index] = OneError("id", $"Person {op.Id} no longer exists.");
                    continue;
                }

                ApplyTo(person, op.Person);
                db.RecordConfiguration(HistoryAction.Updated, person.Id,
                    $"Person {person.DisplayName}", person, actorId);
                await db.SaveChangesAsync(ct);
                results.Add(new PeopleBatchResult(index, null, person.Id));
            }
            else if (op.Kind == "delete" && op.Id is not null)
            {
                var person = await db.People.FirstOrDefaultAsync(p => p.Id == op.Id, ct);
                if (person is null)
                {
                    errors[index] = OneError("id", $"Person {op.Id} no longer exists.");
                    continue;
                }

                if (await HasHistoryAsync(op.Id, db, ct))
                {
                    errors[index] = OneError("id",
                        "Has assignments, absences or comp days — set isActive=false instead of deleting.");
                    continue;
                }

                db.People.Remove(person);
                db.RecordConfiguration(HistoryAction.Deleted, person.Id,
                    $"Person {person.DisplayName}", null, actorId);
                await db.SaveChangesAsync(ct);
                results.Add(new PeopleBatchResult(index, null, person.Id));
            }
            else
            {
                errors[index] = OneError("kind", $"Unsupported operation '{op.Kind}'.");
            }
        }

        if (errors.Count > 0)
        {
            // Nothing is applied when anything fails — which is the whole reason to send
            // these together rather than one at a time.
            await transaction.RollbackAsync(ct);
            return Results.BadRequest(new PeopleBatchErrorResponse("BATCH_REJECTED", errors));
        }

        await transaction.CommitAsync(ct);
        return Results.Ok(new PeopleBatchResponse(results.OrderBy(r => r.Index).ToList()));
    }

    private static IReadOnlyDictionary<string, IEnumerable<string>> OneError(string field, string message) =>
        new Dictionary<string, IEnumerable<string>> { [field] = [message] };

    private static async Task<bool> HasHistoryAsync(string personId, ScheduleDbContext db, CancellationToken ct) =>
        await db.Assignments.AnyAsync(a => a.PersonId == personId, ct)
        || await db.Absences.AnyAsync(a => a.PersonId == personId, ct)
        || await db.CompDayEntries.AnyAsync(c => c.PersonId == personId, ct);

    private static Person NewPerson(AdminPersonRequest req) => new()
    {
        Id = $"p-{Guid.NewGuid():N}",
        DisplayName = req.DisplayName,
        Initials = req.Initials,
        EmployeeId = req.EmployeeId,
        Email = NormalizeEmail(req.Email),
        UnitId = req.UnitId,
        LocationId = req.LocationId,
        OrgCategory = req.OrgCategory,
        IsActive = req.IsActive,
        IsIncluded = req.IsIncluded,
        CalendarToken = Person.NewCalendarToken(),
    };

    private static void ApplyTo(Person person, AdminPersonRequest req)
    {
        person.DisplayName = req.DisplayName;
        person.Initials = req.Initials;
        person.EmployeeId = req.EmployeeId;
        person.Email = NormalizeEmail(req.Email);
        person.UnitId = req.UnitId;
        person.LocationId = req.LocationId;
        person.OrgCategory = req.OrgCategory;
        person.IsActive = req.IsActive;
        person.IsIncluded = req.IsIncluded;
    }

    private static async Task<AdminValidation> ValidateAsync(AdminPersonRequest req, ScheduleDbContext db, CancellationToken ct, string? currentId)
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

        // EmployeeId is the external key an HR import will eventually match people by
        // (AbsenceImportDialog's client-side matchPeople already tries it first) — optional
        // today, but never allowed to collide once set. Mirrors the DB's own filtered
        // unique index (ScheduleDbContext); checked here too so the client gets one
        // consistent 400 field error instead of an unhandled unique-constraint exception.
        if (!string.IsNullOrWhiteSpace(req.EmployeeId) &&
            await db.People.AnyAsync(p => p.EmployeeId == req.EmployeeId && p.Id != currentId, ct))
            v.Add(nameof(req.EmployeeId), "EMPLOYEE_ID_TAKEN — already assigned to another person.");

        // Email is what an Entra ID sign-in resolves to a person by (ADR-0058), so a
        // duplicate is not a cosmetic clash: it would make which person a token maps to
        // depend on row order. Same filtered-unique-index mirror as EmployeeId above.
        var email = NormalizeEmail(req.Email);
        if (email is not null)
        {
            if (!email.Contains('@') || email.StartsWith('@') || email.EndsWith('@'))
                v.Add(nameof(req.Email), "Not a valid email address.");
            else if (await db.People.AnyAsync(p => p.Email == email && p.Id != currentId, ct))
                v.Add(nameof(req.Email), "EMAIL_TAKEN — already assigned to another person.");
        }

        return v;
    }

    /// <summary>Trims and lowercases, so a link is not lost to how somebody typed it —
    /// the token's email casing is not ours to predict.</summary>
    private static string? NormalizeEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
}
