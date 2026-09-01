using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure.Seed;

namespace ShiftOMator.Infrastructure.Setup;

/// <summary>Thrown by a completion method when a <see cref="SystemSetup"/> row already
/// exists. The endpoint maps this to <c>409 SETUP_COMPLETE</c>.</summary>
public sealed class SetupAlreadyCompleteException : InvalidOperationException;

/// <summary>
/// What the setup wizard and Settings → Maintenance actually write (ADR-0059).
///
/// Every method here either creates the one <see cref="SystemSetup"/> row or requires
/// one to already exist — the fixed-key row is the only guard against running twice, and
/// it is checked here rather than trusted to the caller, because a middleware gate racing
/// a direct call to this service is exactly the kind of gap a fixed key exists to close.
/// </summary>
public static class SetupService
{
    public static async Task<bool> IsRequiredAsync(ScheduleDbContext db, CancellationToken ct = default) =>
        !await db.SystemSetups.AnyAsync(ct);

    /// <summary>
    /// One location, one unit, one person — the caller — holding a global Admin grant.
    /// Everything else is typed in on Settings afterward.
    ///
    /// <see cref="Person.UnitId"/> and <see cref="Person.LocationId"/> are required and
    /// non-nullable, which is why a location and a unit are written before the person can
    /// exist at all — not incidental scope, the minimum a person can exist inside.
    /// </summary>
    public static async Task<Person> CompleteBareAsync(
        ScheduleDbContext db,
        string locationName,
        string timeZone,
        string holidayCalendarKey,
        string unitName,
        UnitKind unitKind,
        string displayName,
        string? email,
        CancellationToken ct = default)
    {
        if (await db.SystemSetups.AnyAsync(ct)) throw new SetupAlreadyCompleteException();

        var location = new Location
        {
            Id = $"loc-{Guid.NewGuid():N}",
            Name = locationName,
            Country = string.Empty,
            TimeZone = timeZone,
            HolidayCalendarKey = holidayCalendarKey,
            WeekendDays = [IsoWeekday.Saturday, IsoWeekday.Sunday],
        };

        var unit = new PlanningUnit
        {
            Id = $"unit-{Guid.NewGuid():N}",
            Name = unitName,
            Kind = unitKind,
            GroupBy = GroupBy.OrgCategory,
            PrimaryLocationId = location.Id,
            LocationIds = [location.Id],
            Locations = [location],
            // Not `new()`: every field of the default is a degenerate policy. A zero search
            // window means a comp day can only be placed on the very day that earned it —
            // which the shift that earned it already occupies — so every single one would
            // fall straight to PENDING_APPROVAL; and `AgingThresholdDays = 0` flags every
            // outstanding comp day as overdue the moment it exists. These are the same
            // values every seeded unit carries, and they are editable on Settings → Units.
            CompOffPolicy = new CompOffPolicy
            {
                WindowBeforeDays = 14,
                WindowAfterDays = 14,
                ExcludedWeekdays = [IsoWeekday.Monday, IsoWeekday.Friday],
                AgingThresholdDays = 14,
                RequiresApprovalWhenNoSlot = true,
            },
        };

        var person = new Person
        {
            Id = $"p-{Guid.NewGuid():N}",
            DisplayName = displayName,
            Initials = Initials(displayName),
            Email = NormalizeEmail(email),
            UnitId = unit.Id,
            LocationId = location.Id,
            // Management/not-included: this person exists to administer, not to be
            // planned. Coverage and auto-populate already skip anybody in this state
            // (Person.IsIncluded remarks) — the same shape as every seeded manager.
            OrgCategory = OrgCategory.Management,
            IsActive = true,
            IsIncluded = false,
            CalendarToken = Person.NewCalendarToken(),
        };

        var grant = new RoleAssignment
        {
            Id = Guid.NewGuid().ToString("n"),
            PersonId = person.Id,
            UnitId = null,
            Role = AppRole.Admin,
            GrantedBy = person.Id,
            GrantedAt = DateTimeOffset.UtcNow,
        };

        db.Locations.Add(location);
        db.PlanningUnits.Add(unit);
        db.People.Add(person);
        db.RoleAssignments.Add(grant);
        db.SystemSetups.Add(new SystemSetup
        {
            Preset = SetupPreset.Bare,
            CompletedByPersonId = person.Id,
            CompletedAt = DateTimeOffset.UtcNow,
        });

        await db.SaveChangesAsync(ct);
        return person;
    }

    /// <summary>
    /// The fixture entire, plus — outside Stub mode — the caller's own email linked to
    /// whichever seeded manager holds the global Admin grant, so the person who ran setup
    /// can actually sign back in afterward.
    /// </summary>
    public static async Task<Person?> CompleteDemoAsync(
        ScheduleDbContext db, string? callerEmail, CancellationToken ct = default)
    {
        if (await db.SystemSetups.AnyAsync(ct)) throw new SetupAlreadyCompleteException();

        await FixtureSeeder.SeedDemoAsync(db, ct);
        var linked = string.IsNullOrWhiteSpace(callerEmail)
            ? null
            : await FixtureSeeder.LinkGlobalAdminEmailAsync(db, callerEmail, ct);

        db.SystemSetups.Add(new SystemSetup
        {
            Preset = SetupPreset.Demo,
            CompletedByPersonId = linked?.Id,
            CompletedAt = DateTimeOffset.UtcNow,
        });

        await db.SaveChangesAsync(ct);
        return linked;
    }

    /// <summary>
    /// Whether Settings → Maintenance may offer "Load demo data": only while the system is
    /// still exactly what the Bare preset left it as — the one person setup itself created
    /// and nothing scheduled yet. A database anybody has since typed real people or a real
    /// rota into is not a database the fixture's fixed ids should be merged into.
    /// </summary>
    public static async Task<bool> CanLoadDemoDataAsync(ScheduleDbContext db, CancellationToken ct = default) =>
        await db.People.CountAsync(ct) <= 1
        && !await db.Assignments.AnyAsync(ct)
        && !await db.Absences.AnyAsync(ct)
        && !await db.CompDayEntries.AnyAsync(ct);

    /// <summary>
    /// Replaces a Bare system's single location/unit/admin with the fixture entire,
    /// re-linking whichever email the caller signed in with so they are not locked out of
    /// what they just asked for. Callers must check <see cref="CanLoadDemoDataAsync"/>
    /// first — this throws if the guard no longer holds, which only happens if something
    /// wrote real content between the check and the call.
    /// </summary>
    public static async Task LoadDemoDataAsync(ScheduleDbContext db, CancellationToken ct = default)
    {
        if (!await CanLoadDemoDataAsync(db, ct))
            throw new InvalidOperationException("Demo data can only be loaded into an untouched Bare system.");

        var priorEmail = await db.People.AsNoTracking()
            .Where(p => p.Email != null)
            .Select(p => p.Email)
            .FirstOrDefaultAsync(ct);

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        await DeleteRosterAndPlanAsync(db, ct);
        await FixtureSeeder.SeedDemoAsync(db, ct);
        if (priorEmail is not null)
            await FixtureSeeder.LinkGlobalAdminEmailAsync(db, priorEmail, ct);

        var setup = await db.SystemSetups.SingleAsync(ct);
        setup.Preset = SetupPreset.Demo;
        await db.SaveChangesAsync(ct);

        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Returns to a migrated, empty database — not an absent one (ADR-0059). A drop would
    /// need the app's own connection (and a second replica's) closed first, migrations run
    /// from inside a request, and a managed identity with rights nothing else here needs;
    /// deleting rows needs none of that.
    /// </summary>
    public static async Task ResetAsync(ScheduleDbContext db, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        await DeleteRosterAndPlanAsync(db, ct);
        await db.Notifications.ExecuteDeleteAsync(ct);
        await db.ChangeHistory.ExecuteDeleteAsync(ct);
        await db.Acknowledgements.ExecuteDeleteAsync(ct);
        await db.SystemSetups.ExecuteDeleteAsync(ct);

        await tx.CommitAsync(ct);
    }

    /// <summary>
    /// The tables a preset writes into, in an order that only matters where a real FK
    /// constraint would otherwise refuse it — <c>PlanningUnits</c> cascades to
    /// <c>Shifts</c>/<c>DayConfigurations</c>/<c>ShiftRequirements</c>/
    /// <c>AbsenceCapacityRules</c> and the unit↔location join table; <c>People</c>
    /// cascades to <c>ShiftEligibility</c>; <c>Requests</c> cascades to
    /// <c>ApprovalDecisions</c>; <c>DraftSessions</c> cascades to <c>DraftChanges</c>. None
    /// of the rest carry a real foreign key to any of these — they store the id as a plain
    /// column — so their order relative to the others is not load-bearing.
    ///
    /// Deliberately not <c>ChangeHistory</c>/<c>Notifications</c>/<c>Acknowledgements</c>:
    /// loading a demo dataset over a Bare system keeps the audit trail of how it got there.
    /// <see cref="ResetAsync"/> clears those itself, on top of this.
    /// </summary>
    private static async Task DeleteRosterAndPlanAsync(ScheduleDbContext db, CancellationToken ct)
    {
        await db.Requests.ExecuteDeleteAsync(ct);
        await db.RoleAssignments.ExecuteDeleteAsync(ct);
        await db.Assignments.ExecuteDeleteAsync(ct);
        await db.Absences.ExecuteDeleteAsync(ct);
        await db.Presence.ExecuteDeleteAsync(ct);
        await db.CompDayEntries.ExecuteDeleteAsync(ct);
        await db.DraftSessions.ExecuteDeleteAsync(ct);
        await db.People.ExecuteDeleteAsync(ct);
        await db.PlanningUnits.ExecuteDeleteAsync(ct);
        await db.Locations.ExecuteDeleteAsync(ct);
        await db.Holidays.ExecuteDeleteAsync(ct);
    }

    private static string? NormalizeEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    private static string Initials(string displayName)
    {
        var parts = displayName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var initials = string.Concat(parts.Select(p => char.ToUpperInvariant(p[0])));
        return initials.Length == 0 ? "?" : initials[..Math.Min(3, initials.Length)];
    }
}
