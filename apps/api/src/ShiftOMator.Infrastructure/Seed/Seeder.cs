using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application;
using ShiftOMator.Application.Notifications;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure.Seed;

// One file, three things, in this order:
//
//   1. Seeder            — what runs at startup, and the rule for each kind of data.
//   2. Built-in data     — event types and request types: fixed ids, owned by the code.
//   3. The fixture       — fixture-dataset.json's shape and its mapping onto the domain.
//
// They are together because they are read together: the question "where does this row
// come from" is answered by scrolling, not by opening three files and a JSON blob.

/// <summary>
/// What a database starts with.
///
/// Two sources. **Built-in data** — event types, request types, role grants — is owned by
/// the code and has fixed ids. **The roster and demo plan** come from
/// `fixture-dataset.json`, hand-maintained since Phase 8 deleted Region and moved shifts,
/// day configurations, absence-capacity rules and comp-off policy onto PlanningUnit.
///
/// The plan half — assignments, absences, comp days — only seeds behind
/// <c>includeDemoData</c>: a real deployment must not come up pre-populated with
/// fabricated shifts.
/// </summary>
public static class FixtureSeeder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Brings a database's **reference data** up to the starting set, whatever state it
    /// is in. Runs on every start, on every database — including one that has not been
    /// through the setup wizard yet (ADR-0059): a leave type or a request type the
    /// product ships is part of the product, not a choice an admin makes about whether
    /// the row exists.
    ///
    /// WHY it is not one all-or-nothing guard: reference data with **fixed ids** — event
    /// types, request types — is a set the product needs to exist, and a database that has
    /// some of it needs the rest, not a silent skip. The previous shape bailed out of a
    /// whole block if any row of it existed, so a database seeded before a type was added
    /// never got that type, and the failure was invisible until something asked for it.
    ///
    /// WHY the roster, the demo plan and role grants are **not** here any more: they used
    /// to be written automatically behind an `includeDemoData` flag, which meant a first
    /// production run came up with an invented roster nobody chose (`Seed:IncludeDemoData`
    /// only ever gated the plan, never the seventy-six people). What a database starts as
    /// is now answered once, by whoever opens the app first, on the setup screen — see
    /// <see cref="SeedDemoAsync"/> and <c>SetupService</c> in
    /// <c>ShiftOMator.Infrastructure.Setup</c>.
    ///
    /// <see cref="SeedRolesAsync"/> stays here, unconditional: it is a topped-up derivation
    /// over whatever roster already exists, so it is a no-op on a database the wizard has
    /// not touched yet and a self-healing pass over one it has.
    /// </summary>
    public static async Task SeedAsync(ScheduleDbContext db, CancellationToken ct = default)
    {
        await SeedEventTypesAsync(db, ct);
        await SeedPresenceTypesAsync(db, ct);
        await SeedRequestTypesAsync(db, ct);
        await SeedNotificationRulesAsync(db, ct);
        await SeedRolesAsync(db, ct);
        await UpgradeCalendarTokensAsync(db, ct);
    }

    /// <summary>
    /// Writes the fixture entire — locations, holidays, units, the trimmed roster, shifts,
    /// day configurations, absence-capacity rules, and the demo plan — plus the role
    /// grants it implies. The content half of the setup wizard's Demo preset (ADR-0059).
    ///
    /// Guarded on <c>PlanningUnits</c> being empty as a safety net, not as the real
    /// control: the real control is the caller checking <c>SystemSetup</c> first, the same
    /// way this used to be guarded before the wizard existed at all.
    /// </summary>
    public static async Task SeedDemoAsync(ScheduleDbContext db, CancellationToken ct = default)
    {
        if (await db.PlanningUnits.AnyAsync(ct)) return;

        var dataset = Trimmed(BuildScheduleDataset(includeDemoData: true));

        db.Locations.AddRange(dataset.Locations);
        db.Holidays.AddRange(dataset.Holidays);
        db.PlanningUnits.AddRange(dataset.Units);
        db.People.AddRange(dataset.People);
        db.Assignments.AddRange(dataset.Assignments);
        db.Absences.AddRange(dataset.Absences);
        db.CompDayEntries.AddRange(dataset.CompDays);

        await db.SaveChangesAsync(ct);
        await SeedRolesAsync(db, ct);
    }

    /// <summary>
    /// Gives one named person a way in, by attaching their email to whoever already holds
    /// the global Admin grant (ADR-0058, adapted for ADR-0059's setup wizard).
    ///
    /// The problem this solves is circular. Outside Stub mode a caller is resolved by
    /// matching their token's email against <see cref="Person.Email"/>, which an admin
    /// fills in on Settings → People — a screen nobody can reach until somebody is already
    /// linked. The Demo preset gives a fresh database a full roster, sensible role grants,
    /// and not one row anybody can sign in as; this is the wizard's last step, attaching
    /// the address of whoever just ran it.
    ///
    /// WHY the guard is "no person has an email" and not "no admin exists": role grants are
    /// seeded, so admins always exist; what does not exist is any way to *be* one. The
    /// moment a single person is linked this stops doing anything at all — it cannot
    /// promote a second person later, and cannot silently re-grant after somebody
    /// deliberately removed a grant.
    ///
    /// WHY it links rather than creates: inventing a Person would put a row in the roster
    /// that no planner asked for and that coverage would have to be taught to ignore. The
    /// email is attached to somebody who already holds a global Admin grant — the person
    /// the seed already decided owns cross-unit configuration.
    /// </summary>
    public static async Task<Person?> LinkGlobalAdminEmailAsync(ScheduleDbContext db, string email, CancellationToken ct)
    {
        // Normalized the same way the admin screen and ActorResolver do it, or the link
        // would exist and still not match the token that arrives.
        var normalized = email.Trim().ToLowerInvariant();

        if (await db.People.AnyAsync(p => p.Email != null, ct)) return null;

        var globalAdminId = await db.RoleAssignments.AsNoTracking()
            .Where(r => r.Role == AppRole.Admin && r.UnitId == null)
            .OrderBy(r => r.PersonId)
            .Select(r => r.PersonId)
            .FirstOrDefaultAsync(ct);

        var target = globalAdminId is null
            ? null
            : await db.People.FirstOrDefaultAsync(p => p.Id == globalAdminId, ct);

        if (target is null) return null;

        target.Email = normalized;
        await db.SaveChangesAsync(ct);
        return target;
    }

    /// <summary>
    /// How many working people from each unit the demo roster keeps.
    ///
    /// The full fixture has 76, which is the real team's size and the right number for the
    /// Phase 8 baseline comparison — but it makes the grid a wall to read while testing,
    /// and nothing about the product's behaviour needs more than a handful per unit.
    /// </summary>
    private const int DemoPeoplePerUnit = 6;

    /// <summary>
    /// A smaller roster, with the rows that referenced the people it drops removed too.
    ///
    /// WHY it trims here and not in `fixture-dataset.json`: the fixture is also what the
    /// Phase 8 baseline test compares against, and that comparison is only meaningful over
    /// the full team. The file stays whole; the database gets a slice.
    ///
    /// Managers are all kept regardless of the cap: the seeded role grants are derived from
    /// them, so dropping one would leave a unit with nobody able to plan or approve.
    /// </summary>
    private static ScheduleDataset Trimmed(ScheduleDataset dataset)
    {
        var keep = dataset.People
            .Where(p => p.OrgCategory == OrgCategory.Management)
            .Concat(dataset.People
                .Where(p => p.OrgCategory != OrgCategory.Management)
                .GroupBy(p => p.UnitId)
                .SelectMany(unit => unit.OrderBy(p => p.Id).Take(DemoPeoplePerUnit)))
            .ToList();

        var ids = keep.Select(p => p.Id).ToHashSet();

        return new ScheduleDataset
        {
            Locations = dataset.Locations,
            Holidays = dataset.Holidays,
            Units = dataset.Units,
            Shifts = dataset.Shifts,
            DayConfigurations = dataset.DayConfigurations,
            AbsenceCapacityRules = dataset.AbsenceCapacityRules,
            EventTypes = dataset.EventTypes,
            People = keep,
            Assignments = [.. dataset.Assignments.Where(a => ids.Contains(a.PersonId))],
            Absences = [.. dataset.Absences.Where(a => ids.Contains(a.PersonId))],
            CompDays = [.. dataset.CompDays.Where(c => ids.Contains(c.PersonId))],
        };
    }

    /// <summary>
    /// Inserts the rows of <paramref name="all"/> that are not there yet.
    ///
    /// Fixed ids are what makes this safe: an admin who edited a seeded row keeps their
    /// edit, and a row they deleted on purpose stays deleted only until the next start —
    /// which is the trade for a starting set that is guaranteed to be complete. Deleting a
    /// seeded type is `IsActive = false`, not a DELETE.
    /// </summary>
    private static async Task TopUpAsync<T>(
        ScheduleDbContext db, IReadOnlyList<T> all, Func<T, string> idOf, CancellationToken ct)
        where T : class
    {
        var ids = all.Select(idOf).ToList();
        var existing = await db.Set<T>().AsNoTracking()
            .Where(row => ids.Contains(EF.Property<string>(row, "Id")))
            .Select(row => EF.Property<string>(row, "Id"))
            .ToListAsync(ct);

        var missing = all.Where(row => !existing.Contains(idOf(row))).ToList();
        if (missing.Count == 0) return;

        db.Set<T>().AddRange(missing);
        await db.SaveChangesAsync(ct);
    }

    private static Task SeedEventTypesAsync(ScheduleDbContext db, CancellationToken ct) =>
        TopUpAsync(db, EventTypeSeed.All(), t => t.Id, ct);

    /// <summary>
    /// Replaces any calendar token that came from the fixture with a real secret.
    ///
    /// WHY it runs on every start rather than only on a fresh database: the fixture writes
    /// "tok-{personId}", and that value is the whole of the authentication on a feed URL
    /// anyone can fetch. A database seeded before this existed is holding guessable
    /// credentials, and telling its owner to drop it is not a fix.
    /// </summary>
    private static async Task UpgradeCalendarTokensAsync(ScheduleDbContext db, CancellationToken ct)
    {
        var weak = await db.People.Where(p => p.CalendarToken.StartsWith("tok-")).ToListAsync(ct);
        if (weak.Count == 0) return;

        foreach (var person in weak) person.CalendarToken = Person.NewCalendarToken();
        await db.SaveChangesAsync(ct);
    }

    private static Task SeedPresenceTypesAsync(ScheduleDbContext db, CancellationToken ct) =>
        TopUpAsync(db, PresenceTypeSeed.All(), t => t.Id, ct);

    /// <summary>
    /// A starting set of role grants, so a fresh database is usable rather than one where
    /// nobody can do anything (ADR-0051).
    ///
    /// Every manager plans, approves and administers their own unit. That is a starting
    /// point an admin then narrows — not a claim about how the team is really organised,
    /// which is exactly the sort of thing a seed must not invent. One person also gets a
    /// global Admin grant, because the configuration that belongs to no unit (locations,
    /// holidays, the units themselves) would otherwise have no owner at all.
    /// </summary>
    private static async Task SeedRolesAsync(ScheduleDbContext db, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        // Read from the database, not from the fixture: on an upgraded database the roster
        // was seeded on an earlier run and there is no fixture in scope.
        var managers = await db.People.AsNoTracking()
            .Where(p => p.OrgCategory == OrgCategory.Management && p.IsActive)
            .OrderBy(p => p.Id)
            .ToListAsync(ct);
        if (managers.Count == 0) return;

        var grants = new List<RoleAssignment>();
        void Grant(string personId, AppRole role, string? unitId) =>
            grants.Add(new RoleAssignment
            {
                Id = $"ra-{personId}-{role}-{unitId ?? "global"}".ToLowerInvariant(),
                PersonId = personId,
                UnitId = unitId,
                Role = role,
                GrantedBy = "seed",
                GrantedAt = now,
            });

        foreach (var manager in managers)
        {
            Grant(manager.Id, AppRole.Planner, manager.UnitId);
            Grant(manager.Id, AppRole.Approver, manager.UnitId);
            Grant(manager.Id, AppRole.Admin, manager.UnitId);
        }

        // A unit with no manager would otherwise come up with nobody able to plan, approve
        // or administer it — every screen read-only, for no stated reason. The fixture has
        // exactly one such unit, and a real roster will have more.
        var covered = managers.Select(m => m.UnitId).ToHashSet();
        var orphanUnits = await db.PlanningUnits.AsNoTracking()
            .Where(u => !covered.Contains(u.Id))
            .Select(u => u.Id)
            .ToListAsync(ct);

        foreach (var unitId in orphanUnits)
        {
            var standIn = await db.People.AsNoTracking()
                .Where(p => p.UnitId == unitId && p.IsActive)
                .OrderBy(p => p.Id)
                .Select(p => p.Id)
                .FirstOrDefaultAsync(ct);
            if (standIn is null) continue;

            Grant(standIn, AppRole.Planner, unitId);
            Grant(standIn, AppRole.Approver, unitId);
            Grant(standIn, AppRole.Admin, unitId);
        }

        Grant(managers[0].Id, AppRole.Admin, null);

        // Topped up rather than written once (the same rule as event types): the grants are
        // derived from the roster, and both grow. A blanket "if any grant exists, skip"
        // meant a unit that gained people later — or a fix to this very function — never
        // reached a database that had been seeded before.
        //
        // Only missing grants are added. A grant an admin revoked on purpose comes back on
        // the next start, which is the same trade the seeded event types make: a starting
        // set that is guaranteed complete, narrowed afterwards.

        await TopUpAsync(db, grants, g => g.Id, ct);
    }

    /// <summary>
    /// The starting set of request types (ADR-0047). One per thing somebody can ask for:
    /// the two presence kinds, each leave type that needs approval, and comp-day
    /// placement. Admin-editable data, not code — adding a type is a row.
    /// </summary>
    private static Task SeedRequestTypesAsync(ScheduleDbContext db, CancellationToken ct) =>
        TopUpAsync(db, RequestTypeSeed(), t => t.Id, ct);

    /// <summary>
    /// The notification matrix: every kind against every real channel, off (ADR-0064).
    ///
    /// Topped up per row rather than seeded once, which is what makes a
    /// <see cref="NotificationKind"/> added in code appear on Settings → Notifications by
    /// itself. An administrator's ticks survive, because a row that exists is left alone.
    /// </summary>
    private static Task SeedNotificationRulesAsync(ScheduleDbContext db, CancellationToken ct) =>
        TopUpAsync(db, NotificationFanout.DefaultMatrix(), r => r.Id, ct);

    private static IReadOnlyList<RequestType> RequestTypeSeed() =>
        [
            new RequestType
            {
                Id = "rt-remote",
                Code = "REMOTE",
                Label = "Work remotely",
                Category = RequestCategory.Presence,
                Materializer = Domain.RequestMaterializer.Presence,
                PresenceTypeId = PresenceTypeIds.Remote,
                SortOrder = 1,
            },
            new RequestType
            {
                Id = "rt-office",
                Code = "OFFICE",
                Label = "Work from an office",
                Category = RequestCategory.Presence,
                Materializer = Domain.RequestMaterializer.Presence,
                PresenceTypeId = PresenceTypeIds.Office,
                SortOrder = 2,
            },
            // Sickness is requested like any other leave (ADR-0052). Without a request
            // type for it the menu offered sick leave and then had nowhere to send it.
            // Travel and customer site are ordinarily statements of fact, written
            // straight in. They still get a request type, because whether a presence kind
            // needs approving is a `PresenceType` row an admin can flip — and a flag with
            // nowhere to send the request would be a dead end.
            new RequestType
            {
                Id = "rt-travel",
                Code = "TRAVEL",
                Label = "Travelling",
                Category = RequestCategory.Presence,
                Materializer = Domain.RequestMaterializer.Presence,
                PresenceTypeId = PresenceTypeIds.Travel,
                SortOrder = 2,
            },
            new RequestType
            {
                Id = "rt-customer-site",
                Code = "CUSTOMER_SITE",
                Label = "On customer site",
                Category = RequestCategory.Presence,
                Materializer = Domain.RequestMaterializer.Presence,
                PresenceTypeId = PresenceTypeIds.CustomerSite,
                SortOrder = 2,
            },
            new RequestType
            {
                Id = "rt-sick",
                Code = "SICK",
                Label = "Sick leave",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.Sick,
                SortOrder = 3,
            },
            new RequestType
            {
                Id = "rt-vacation",
                Code = "VACATION",
                Label = "Annual leave",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.Vacation,
                SortOrder = 3,
            },
            new RequestType
            {
                Id = "rt-other-leave",
                Code = "OTHER_LEAVE",
                Label = "Other leave",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.Other,
                SortOrder = 4,
            },
            // One request type per approval-needing event type, so "ask for a personal
            // day" is offered the same way annual leave is (ADR-0049).
            new RequestType
            {
                Id = "rt-floating-holiday",
                Code = "FLOATING_HOLIDAY",
                Label = "Floating holiday",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.FloatingHoliday,
                SortOrder = 5,
            },
            new RequestType
            {
                Id = "rt-personal-day",
                Code = "PERSONAL_DAY",
                Label = "Personal day",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.PersonalDay,
                SortOrder = 6,
            },
            new RequestType
            {
                Id = "rt-unpaid-leave",
                Code = "UNPAID_LEAVE",
                Label = "Unpaid leave",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.UnpaidLeave,
                SortOrder = 7,
            },
            // Placing an earned comp day (ADR-0052). It creates nothing — the accrual
            // already exists — it settles which day it is taken on.
            new RequestType
            {
                Id = "rt-comp-day",
                Code = "COMP_DAY",
                Label = "Comp day",
                Category = RequestCategory.CompDay,
                Materializer = Domain.RequestMaterializer.CompDay,
                SortOrder = 9,
            },
            new RequestType
            {
                Id = "rt-furlough",
                Code = "FURLOUGH",
                Label = "Furlough",
                Category = RequestCategory.Leave,
                Materializer = Domain.RequestMaterializer.Absence,
                EventTypeId = EventTypeIds.Furlough,
                SortOrder = 8,
            },
        ];

    /// <summary>
    /// The same mapping <see cref="SeedAsync"/> uses, without touching a DbContext — for
    /// the Phase 8 baseline comparison test, which needs a fully-built
    /// <see cref="ScheduleDataset"/> with no database.
    /// </summary>
    public static ScheduleDataset BuildScheduleDataset(bool includeDemoData)
    {
        var dataset = LoadDataset();

        var locations = dataset.Locations.Select(ToLocation).ToList();
        var locationsById = locations.ToDictionary(l => l.Id);

        var units = dataset.Units.Select(u => new PlanningUnit
        {
            Id = u.Id,
            Name = u.Name,
            Kind = u.Kind == "REGION" ? UnitKind.Region : UnitKind.CrossRegion,
            GroupBy = u.GroupBy switch
            {
                "LOCATION" => GroupBy.Location,
                "REGION" => GroupBy.Region,
                _ => GroupBy.OrgCategory,
            },
            PrimaryLocationId = u.PrimaryLocationId,
            LocationIds = [.. u.LocationIds],
            CompOffPolicy = new CompOffPolicy
            {
                WindowBeforeDays = u.CompOffPolicy.WindowBeforeDays,
                WindowAfterDays = u.CompOffPolicy.WindowAfterDays,
                ExcludedWeekdays = [.. u.CompOffPolicy.ExcludedWeekdays.Select(ToWeekday)],
                AgingThresholdDays = u.CompOffPolicy.AgingThresholdDays,
                RequiresApprovalWhenNoSlot = u.CompOffPolicy.RequiresApprovalWhenNoSlot,
            },
            Locations = [.. u.LocationIds.Select(id => locationsById[id])],
            Shifts = [.. u.Shifts.Select(s => ToShift(s, u.Id))],
            DayConfigurations = [.. u.DayConfigurations.Select(c => ToDayConfiguration(c, u.Id))],
            AbsenceCapacityRules = [.. u.AbsenceCapacityRules.Select(r => ToAbsenceCapacityRule(r, u.Id))],
        }).ToList();

        var people = dataset.People.Select(p => new Person
        {
            Id = p.Id,
            DisplayName = p.DisplayName,
            Initials = p.Initials,
            EmployeeId = p.EmployeeId,
            UnitId = p.UnitId,
            LocationId = p.LocationId,
            OrgCategory = ToOrgCategory(p.OrgCategory),
            IsActive = p.IsActive,
            IsIncluded = p.IsIncluded,
            AvailableWeekdays = [.. p.AvailableWeekdays.Select(ToWeekday)],
            DefaultShiftId = p.DefaultShiftId,
            WeekendEligible = p.WeekendEligible,
            Constraints = new PersonConstraints
            {
                MinRestHours = p.Constraints.MinRestHours,
                MaxConsecutiveDays = p.Constraints.MaxConsecutiveDays,
                MaxWeekendsPerQuarter = p.Constraints.MaxWeekendsPerQuarter,
            },
            Preferences = p.Preferences is null
                ? null
                : new PersonPreferences
                {
                    AvoidsWeekdays = [.. (p.Preferences.AvoidsWeekdays ?? []).Select(ToWeekday)],
                    PreferredPartnerIds = p.Preferences.PreferredPartnerIds ?? [],
                    BlackoutDates =
                    [
                        .. (p.Preferences.BlackoutDates ?? []).Select(d =>
                            DateOnly.Parse(d, CultureInfo.InvariantCulture)),
                    ],
                    Note = p.Preferences.Note,
                },
            // Not the fixture's: it writes "tok-{personId}", which is a guessable
            // credential on an endpoint that has no other one. The fixture keeps the field
            // because the Phase 8 baseline compares whole objects; the database gets a
            // secret.
            CalendarToken = Person.NewCalendarToken(),
            Eligibility =
            [
                .. p.Eligibility.Select(e => new ShiftEligibility
                {
                    PersonId = p.Id,
                    ShiftId = e.ShiftId,
                    TargetShare = e.TargetShare,
                    MinPerWeek = e.MinPerWeek,
                    MaxPerWeek = e.MaxPerWeek,
                }),
            ],
        }).ToList();

        return new ScheduleDataset
        {
            Locations = locations,
            Holidays = [.. dataset.Holidays.Select(ToHoliday)],
            Units = units,
            Shifts = [.. units.SelectMany(u => u.Shifts)],
            DayConfigurations = [.. units.SelectMany(u => u.DayConfigurations)],
            AbsenceCapacityRules = [.. units.SelectMany(u => u.AbsenceCapacityRules)],
            People = people,
            // Marker rows in the fixture are dropped rather than converted: an assignment
            // is a shift now (ADR-0052), and "off" is the absence of one.
            Assignments = includeDemoData
                ? [.. dataset.Assignments.Where(a => a.Content.ShiftId is not null).Select(ToAssignment)]
                : [],
            Absences = includeDemoData ? [.. dataset.Absences.Select(ToAbsence)] : [],
            CompDays = includeDemoData ? [.. dataset.CompDays.Select(ToCompDay)] : [],
        };
    }

    private static SeedDataset LoadDataset()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Seed", "fixture-dataset.json");
        using var stream = File.OpenRead(path);
        return JsonSerializer.Deserialize<SeedDataset>(stream, JsonOptions)
            ?? throw new InvalidOperationException("fixture-dataset.json deserialized to null");
    }

    private static Location ToLocation(SeedLocation l) => new()
    {
        Id = l.Id,
        Name = l.Name,
        Country = l.Country,
        TimeZone = l.TimeZone,
        HolidayCalendarKey = l.HolidayCalendarKey,
        WeekendDays = [.. l.WeekendDays.Select(ToWeekday)],
    };

    private static Holiday ToHoliday(SeedHoliday h) => new()
    {
        Id = h.Id,
        Date = DateOnly.Parse(h.Date, CultureInfo.InvariantCulture),
        Name = h.Name,
        LocationIds = [.. h.LocationIds],
        IsFullDay = h.IsFullDay,
    };

    private static Shift ToShift(SeedShift s, string unitId) => new()
    {
        Id = s.Id,
        UnitId = unitId,
        Code = s.Code,
        Label = s.Label,
        Description = s.Description,
        Color = s.Color,
        Hotkey = s.Hotkey,
        TimeZone = s.TimeZone,
        Start = TimeOnly.Parse(s.Start, CultureInfo.InvariantCulture),
        End = TimeOnly.Parse(s.End, CultureInfo.InvariantCulture),
        CrossesMidnight = s.CrossesMidnight,
        BreakMinutes = s.BreakMinutes,
        CountsAsCoverage = s.CountsAsCoverage,
        EditableTime = s.EditableTime,
    };

    private static DayConfiguration ToDayConfiguration(SeedDayConfiguration c, string unitId) => new()
    {
        Id = c.Id,
        UnitId = unitId,
        Key = ToDayConfigKey(c.Key),
        Weekdays = [.. c.Weekdays.Select(ToWeekday)],
        Date = c.Date is null ? null : DateOnly.Parse(c.Date, CultureInfo.InvariantCulture),
        Label = c.Label,
        EffectiveFrom = DateOnly.Parse(c.EffectiveFrom, CultureInfo.InvariantCulture),
        ShiftRequirements =
        [
            .. c.ShiftRequirements.Select(rr => new ShiftRequirement
            {
                DayConfigurationId = c.Id,
                ShiftId = rr.ShiftId,
                Min = rr.Min,
                Max = rr.Max,
                IsDefault = rr.IsDefault,
            }),
        ],
    };

    private static AbsenceCapacityRule ToAbsenceCapacityRule(SeedAbsenceCapacityRule r, string unitId) => new()
    {
        Id = r.Id,
        UnitId = unitId,
        ScopeKind = r.Scope.Kind == "UNIT" ? AbsenceCapacityScopeKind.Unit : AbsenceCapacityScopeKind.ShiftPool,
        ScopeShiftId = r.Scope.ShiftId,
        DurationBucket = r.DurationBucket == "LONG" ? AbsenceDurationBucket.Long : AbsenceDurationBucket.Short,
        LongThresholdWorkdays = r.LongThresholdWorkdays,
        MaxConcurrent = r.MaxConcurrent,
        CountsEventTypeIds = [.. r.CountsTypes.Select(ToEventTypeId)],
        CountsCompDays = r.CountsCompDays,
    };

    private static Assignment ToAssignment(SeedAssignment a) => new()
    {
        Id = a.Id,
        PersonId = a.PersonId,
        Date = DateOnly.Parse(a.Date, CultureInfo.InvariantCulture),
        UnitId = a.UnitId,
        ShiftId = a.Content.ShiftId!,
        TimeOverride = a.Content.TimeOverride is null
            ? null
            : new Domain.TimeOverride
            {
                Start = TimeOnly.Parse(a.Content.TimeOverride.Start, CultureInfo.InvariantCulture),
                End = TimeOnly.Parse(a.Content.TimeOverride.End, CultureInfo.InvariantCulture),
                CrossesMidnight = a.Content.TimeOverride.CrossesMidnight,
            },
        IsWeekend = a.IsWeekend,
        Note = a.Note,
        Source = a.Source switch
        {
            "MANUAL" => AssignmentSource.Manual,
            "GENERATED" => AssignmentSource.Generated,
            _ => AssignmentSource.Imported,
        },
        Version = a.Version,
        CreatedBy = a.CreatedBy,
        CreatedAt = DateTimeOffset.Parse(a.CreatedAt, CultureInfo.InvariantCulture),
        UpdatedBy = a.UpdatedBy,
        UpdatedAt = a.UpdatedAt is null ? null : DateTimeOffset.Parse(a.UpdatedAt, CultureInfo.InvariantCulture),
    };

    private static Absence ToAbsence(SeedAbsence a) => new()
    {
        Id = a.Id,
        PersonId = a.PersonId,
        EventTypeId = ToEventTypeId(a.Type),
        From = DateOnly.Parse(a.From, CultureInfo.InvariantCulture),
        To = DateOnly.Parse(a.To, CultureInfo.InvariantCulture),
        Source = a.Source == "IMPORT" ? AbsenceSource.Import : AbsenceSource.Manual,
        ImportBatchId = a.ImportBatchId,
        LastSeenInImportAt = a.LastSeenInImportAt is null
            ? null
            : DateTimeOffset.Parse(a.LastSeenInImportAt, CultureInfo.InvariantCulture),
        SyncedToHrAt = a.SyncedToHrAt is null ? null : DateTimeOffset.Parse(a.SyncedToHrAt, CultureInfo.InvariantCulture),
        Note = a.Note,
    };

    private static CompDayEntry ToCompDay(SeedCompDay c) => new()
    {
        Id = c.Id,
        PersonId = c.PersonId,
        EarnedForAssignmentId = c.EarnedForAssignmentId,
        EarnedForDate = DateOnly.Parse(c.EarnedForDate, CultureInfo.InvariantCulture),
        Trigger = c.Trigger switch
        {
            "SATURDAY" => CompDayTrigger.Saturday,
            "SUNDAY" => CompDayTrigger.Sunday,
            _ => CompDayTrigger.Holiday,
        },
        ProposedDate = c.ProposedDate is null ? null : DateOnly.Parse(c.ProposedDate, CultureInfo.InvariantCulture),
        ActualDate = c.ActualDate is null ? null : DateOnly.Parse(c.ActualDate, CultureInfo.InvariantCulture),
        Status = c.Status switch
        {
            "PROPOSED" => CompDayStatus.Proposed,
            "SCHEDULED" => CompDayStatus.Scheduled,
            "TAKEN" => CompDayStatus.Taken,
            "DECLINED" => CompDayStatus.Declined,
            _ => CompDayStatus.PendingApproval,
        },
        SyncedToHrAt = c.SyncedToHrAt is null ? null : DateTimeOffset.Parse(c.SyncedToHrAt, CultureInfo.InvariantCulture),
    };

    private static IsoWeekday ToWeekday(int n) => (IsoWeekday)n;

    private static DayConfigKey ToDayConfigKey(string key) => key switch
    {
        "weekday" => DayConfigKey.Weekday,
        "friday" => DayConfigKey.Friday,
        "weekend" => DayConfigKey.Weekend,
        "holiday" => DayConfigKey.Holiday,
        _ => DayConfigKey.Date,
    };

    private static OrgCategory ToOrgCategory(string s) => s switch
    {
        "SUPPORT" => OrgCategory.Support,
        "SERVICE_TRANSITION" => OrgCategory.ServiceTransition,
        _ => OrgCategory.Management,
    };

    /// <summary>Fixture codes map onto seeded <see cref="EventType"/> ids (ADR-0049).
    /// Anything unrecognised lands on "other" rather than failing the seed.</summary>
    private static string ToEventTypeId(string s) => s switch
    {
        "VACATION" => EventTypeIds.Vacation,
        "SICK" => EventTypeIds.Sick,
        _ => EventTypeIds.Other,
    };
}

// ---------------------------------------------------------------------------
// 2. Built-in reference data
// ---------------------------------------------------------------------------

/// <summary>
/// Ids of the seeded event types. Constants rather than magic strings because the
/// fixture mapping, the request types and the capacity rules all have to agree on them.
/// </summary>
public static class EventTypeIds
{
    public const string Vacation = "et-vacation";
    public const string Sick = "et-sick";
    public const string FloatingHoliday = "et-floating-holiday";
    public const string PersonalDay = "et-personal-day";
    public const string UnpaidLeave = "et-unpaid-leave";
    public const string Furlough = "et-furlough";
    public const string Other = "et-other";
    public const string Unavailable = "et-unavailable";
}

/// <summary>
/// The starting set of non-working day types (ADR-0049). All of it is data an admin can
/// extend; this is a starting point, not a closed list.
/// </summary>
public static class EventTypeSeed
{
    public static IReadOnlyList<EventType> All() =>
    [
        new()
        {
            Id = EventTypeIds.Vacation,
            Code = "VACATION",
            Label = "Annual leave",
            ShortLabel = "Leave",
            Color = "#7c9cf5",
            Category = EventCategory.Leave,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            SortOrder = 1,
        },
        new()
        {
            Id = EventTypeIds.Sick,
            Code = "SICK",
            Label = "Sick leave",
            ShortLabel = "Sick",
            Color = "#e08c8c",
            Category = EventCategory.Sickness,
            BlocksAssignment = true,
            // Sickness is not planned, so counting it against a "how many may be away at
            // once" limit would flag the team for something nobody chose.
            CountsTowardCapacity = false,
            // Requested like any other leave. The earlier reading — "you are already off,
            // approval would be theatre" — described the *notification*, not the record: a
            // sick day still has to be accepted by somebody before it stands as the reason
            // a shift went uncovered, and the person reporting it is rarely the person who
            // signs it off.
            RequiresApproval = true,
            AllowsHalfDay = true,
            SortOrder = 2,
        },
        new()
        {
            Id = EventTypeIds.FloatingHoliday,
            Code = "FLOATING_HOLIDAY",
            Label = "Floating holiday",
            ShortLabel = "Float",
            Color = "#8fc7a8",
            Category = EventCategory.Leave,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            SortOrder = 3,
        },
        new()
        {
            Id = EventTypeIds.PersonalDay,
            Code = "PERSONAL_DAY",
            Label = "Personal day",
            ShortLabel = "Pers",
            Color = "#c3a3e0",
            Category = EventCategory.Leave,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            SortOrder = 4,
        },
        new()
        {
            Id = EventTypeIds.UnpaidLeave,
            Code = "UNPAID_LEAVE",
            Label = "Unpaid leave",
            ShortLabel = "Unpaid",
            Color = "#b0b7c3",
            Category = EventCategory.Leave,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            SortOrder = 5,
        },
        new()
        {
            Id = EventTypeIds.Furlough,
            Code = "FURLOUGH",
            Label = "Furlough",
            ShortLabel = "Furl",
            Color = "#9aa3ad",
            Category = EventCategory.Other,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            // Whole periods, never a morning.
            AllowsHalfDay = false,
            SortOrder = 6,
        },
        new()
        {
            Id = EventTypeIds.Other,
            Code = "OTHER",
            Label = "Other absence",
            ShortLabel = "Absent",
            Color = "#a8b0bb",
            Category = EventCategory.Other,
            BlocksAssignment = true,
            CountsTowardCapacity = true,
            RequiresApproval = true,
            SortOrder = 7,
        },
        new()
        {
            Id = EventTypeIds.Unavailable,
            Code = "UNAVAILABLE",
            Label = "Not available",
            ShortLabel = "N/A",
            Color = "#8f97a3",
            Category = EventCategory.Other,
            // What replaced the OFF / NOT_SCHEDULED markers (ADR-0052). An engineer says
            // "do not put me on a shift that day" — most often about a weekend they are
            // not willing to cover. It is a declaration of availability, so it needs no
            // approval; a planner can still assign over it and get a flagged conflict,
            // exactly as with any other absence.
            BlocksAssignment = true,
            // Not time off: counting it against "how many may be away at once" would flag
            // a team for people who are simply not on the rota that day.
            CountsTowardCapacity = false,
            RequiresApproval = false,
            AllowsHalfDay = true,
            SortOrder = 8,
        },
    ];
}

// ---------------------------------------------------------------------------
// 3. The fixture: fixture-dataset.json, mirrored as plain classes for
//    System.Text.Json. Mutable and property-per-field on purpose — this is a
//    deserialization target, not a domain type.
// ---------------------------------------------------------------------------

public class SeedDataset
{
    public List<SeedLocation> Locations { get; set; } = [];
    public List<SeedHoliday> Holidays { get; set; } = [];
    public List<SeedUnit> Units { get; set; } = [];
    public List<SeedPerson> People { get; set; } = [];
    public List<SeedAssignment> Assignments { get; set; } = [];
    public List<SeedAbsence> Absences { get; set; } = [];
    public List<SeedCompDay> CompDays { get; set; } = [];
}

public class SeedLocation
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Country { get; set; }
    public required string TimeZone { get; set; }
    public required string HolidayCalendarKey { get; set; }
    public List<int> WeekendDays { get; set; } = [];
}

public class SeedHoliday
{
    public required string Id { get; set; }
    public required string Date { get; set; }
    public required string Name { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public bool IsFullDay { get; set; }
}

public class SeedCompOffPolicy
{
    public int WindowBeforeDays { get; set; }
    public int WindowAfterDays { get; set; }
    public List<int> ExcludedWeekdays { get; set; } = [];
    public int AgingThresholdDays { get; set; }
    public bool RequiresApprovalWhenNoSlot { get; set; }
}

/// <summary>
/// The single rule axis (Region deleted) — owns shifts, day configurations,
/// absence-capacity rules and comp-off policy directly, the way SeedRegion used to.
/// </summary>
public class SeedUnit
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Kind { get; set; }
    public required string GroupBy { get; set; }
    public required string PrimaryLocationId { get; set; }
    public List<string> LocationIds { get; set; } = [];
    public SeedCompOffPolicy CompOffPolicy { get; set; } = new();
    public List<SeedShift> Shifts { get; set; } = [];
    public List<SeedDayConfiguration> DayConfigurations { get; set; } = [];
    public List<SeedAbsenceCapacityRule> AbsenceCapacityRules { get; set; } = [];
}

public class SeedShift
{
    public required string Id { get; set; }
    public required string Code { get; set; }
    public required string Label { get; set; }
    public string? Description { get; set; }
    public required string Color { get; set; }
    public string? Hotkey { get; set; }
    public required string TimeZone { get; set; }
    public required string Start { get; set; }
    public required string End { get; set; }
    public bool CrossesMidnight { get; set; }
    public int BreakMinutes { get; set; }
    public bool CountsAsCoverage { get; set; }
    public bool EditableTime { get; set; }
}

public class SeedShiftRequirement
{
    public required string ShiftId { get; set; }
    public int Min { get; set; }
    public int? Max { get; set; }
    public bool IsDefault { get; set; }
}

public class SeedDayConfiguration
{
    public required string Id { get; set; }
    public required string Key { get; set; }
    public List<int> Weekdays { get; set; } = [];
    public string? Date { get; set; }
    public string? Label { get; set; }
    public required string EffectiveFrom { get; set; }
    public List<SeedShiftRequirement> ShiftRequirements { get; set; } = [];
}

public class SeedShiftEligibility
{
    public required string ShiftId { get; set; }
    public double TargetShare { get; set; }
    public int? MinPerWeek { get; set; }
    public int? MaxPerWeek { get; set; }
}

public class SeedPersonConstraints
{
    public int MinRestHours { get; set; }
    public int MaxConsecutiveDays { get; set; }
    public int? MaxWeekendsPerQuarter { get; set; }
}

public class SeedPersonPreferences
{
    public List<int>? AvoidsWeekdays { get; set; }
    public List<string>? PreferredPartnerIds { get; set; }
    public List<string>? BlackoutDates { get; set; }
    public string? Note { get; set; }
}

public class SeedPerson
{
    public required string Id { get; set; }
    public required string DisplayName { get; set; }
    public required string Initials { get; set; }
    public string? EmployeeId { get; set; }
    public required string UnitId { get; set; }
    public required string LocationId { get; set; }
    public required string OrgCategory { get; set; }
    public bool IsActive { get; set; }
    public bool IsIncluded { get; set; }
    public List<SeedShiftEligibility> Eligibility { get; set; } = [];
    public List<int> AvailableWeekdays { get; set; } = [];
    public string? DefaultShiftId { get; set; }
    public bool WeekendEligible { get; set; }
    public SeedPersonConstraints Constraints { get; set; } = new();
    public SeedPersonPreferences? Preferences { get; set; }
    public required string CalendarToken { get; set; }
}

public class SeedScope
{
    public required string Kind { get; set; }
    public string? ShiftId { get; set; }
}

public class SeedAbsenceCapacityRule
{
    public required string Id { get; set; }
    public SeedScope Scope { get; set; } = new() { Kind = "UNIT" };
    public required string DurationBucket { get; set; }
    public int LongThresholdWorkdays { get; set; }
    public int MaxConcurrent { get; set; }
    public List<string> CountsTypes { get; set; } = [];
    public bool CountsCompDays { get; set; }
}

public class SeedTimeOverride
{
    public required string Start { get; set; }
    public required string End { get; set; }
    public bool CrossesMidnight { get; set; }
}

public class SeedAssignmentContent
{
    public required string Kind { get; set; }
    public string? ShiftId { get; set; }
    public SeedTimeOverride? TimeOverride { get; set; }
    public string? Marker { get; set; }
}

public class SeedAssignment
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public required string Date { get; set; }
    public required string UnitId { get; set; }
    public SeedAssignmentContent Content { get; set; } = new() { Kind = "SHIFT" };
    public bool IsWeekend { get; set; }
    public string? Note { get; set; }
    public required string Source { get; set; }
    public int Version { get; set; }
    public required string CreatedBy { get; set; }
    public required string CreatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public string? UpdatedAt { get; set; }
}

public class SeedAbsence
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public required string Type { get; set; }
    public required string From { get; set; }
    public required string To { get; set; }
    public required string Source { get; set; }
    public string? ImportBatchId { get; set; }
    public string? LastSeenInImportAt { get; set; }
    public string? SyncedToHrAt { get; set; }
    public string? Note { get; set; }
}

public class SeedCompDay
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    public required string EarnedForAssignmentId { get; set; }
    public required string EarnedForDate { get; set; }
    public required string Trigger { get; set; }
    public string? ProposedDate { get; set; }
    public string? ActualDate { get; set; }
    public required string Status { get; set; }
    public string? SyncedToHrAt { get; set; }
}

/// <summary>
/// The starting set of presence types (ADR-0043, ADR-0054). Topped up by id like every
/// other reference row, so an edit survives a restart and a type added in a later release
/// reaches a database that predates it.
///
/// Remote is the only one seeded as needing approval, because it is the only one the
/// business has an opinion about. That is a default, not a rule: which ways of working
/// need signing off is a column precisely so a team that feels differently changes a row.
/// </summary>
public static class PresenceTypeSeed
{
    public static IReadOnlyList<PresenceType> All() =>
    [
        new()
        {
            Id = PresenceTypeIds.Office,
            Label = "In the office",
            Glyph = "O",
            Color = "#15803d",
            NamesALocation = true,
            CountsAs = PresenceGroup.OnSite,
            RequiresApproval = false,
            SortOrder = 1,
        },
        new()
        {
            Id = PresenceTypeIds.Remote,
            Label = "Remote",
            Glyph = "R",
            Color = "#2563eb",
            CountsAs = PresenceGroup.Remote,
            RequiresApproval = true,
            SortOrder = 2,
        },
        new()
        {
            Id = PresenceTypeIds.Travel,
            Label = "Travelling",
            Glyph = "T",
            Color = "#b45309",
            CountsAs = PresenceGroup.Away,
            RequiresApproval = false,
            SortOrder = 3,
        },
        new()
        {
            Id = PresenceTypeIds.CustomerSite,
            Label = "On customer site",
            Glyph = "C",
            Color = "#9333ea",
            CountsAs = PresenceGroup.Away,
            RequiresApproval = false,
            SortOrder = 4,
        },
    ];
}
