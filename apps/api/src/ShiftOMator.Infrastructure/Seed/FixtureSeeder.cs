using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure.Seed;

/// <summary>
/// Seeds from `fixture-dataset.json`, hand-maintained since Phase 8 deleted Region and
/// moved shifts/day configurations/absence-capacity rules/comp-off policy onto
/// PlanningUnit — the TypeScript client this used to mirror (`domain/fixtures.ts`) no
/// longer exists (Phase 5 deleted the client-side engines and fixtures along with it).
///
/// Reference data (locations, units, shifts, day configurations, holidays, people, ...)
/// always seeds. Plan data (assignments, absences, comp days) only seeds when
/// <paramref name="includeDemoData"/> is true — a real deployment must not come up
/// pre-populated with fabricated shifts.
/// </summary>
public static class FixtureSeeder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static async Task SeedAsync(ScheduleDbContext db, bool includeDemoData, CancellationToken ct = default)
    {
        if (await db.PlanningUnits.AnyAsync(ct)) return;

        var dataset = BuildScheduleDataset(includeDemoData);

        db.Locations.AddRange(dataset.Locations);
        db.Holidays.AddRange(dataset.Holidays);
        db.PlanningUnits.AddRange(dataset.Units);
        db.People.AddRange(dataset.People);

        if (includeDemoData)
        {
            db.Assignments.AddRange(dataset.Assignments);
            db.Absences.AddRange(dataset.Absences);
            db.CompDayEntries.AddRange(dataset.CompDays);
        }

        await db.SaveChangesAsync(ct);
    }

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
            CalendarToken = p.CalendarToken,
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
            Assignments = includeDemoData ? [.. dataset.Assignments.Select(ToAssignment)] : [],
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
        CountsTypes = [.. r.CountsTypes.Select(ToAbsenceType)],
        CountsCompDays = r.CountsCompDays,
    };

    private static Assignment ToAssignment(SeedAssignment a) => new()
    {
        Id = a.Id,
        PersonId = a.PersonId,
        Date = DateOnly.Parse(a.Date, CultureInfo.InvariantCulture),
        UnitId = a.UnitId,
        ContentKind = a.Content.Kind == "SHIFT" ? AssignmentContentKind.Shift : AssignmentContentKind.Marker,
        ShiftId = a.Content.ShiftId,
        TimeOverride = a.Content.TimeOverride is null
            ? null
            : new Domain.TimeOverride
            {
                Start = TimeOnly.Parse(a.Content.TimeOverride.Start, CultureInfo.InvariantCulture),
                End = TimeOnly.Parse(a.Content.TimeOverride.End, CultureInfo.InvariantCulture),
                CrossesMidnight = a.Content.TimeOverride.CrossesMidnight,
            },
        Marker = a.Content.Marker switch
        {
            "OFF" => RosterMarker.Off,
            "NOT_SCHEDULED" => RosterMarker.NotScheduled,
            _ => null,
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
        Type = ToAbsenceType(a.Type),
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

    private static AbsenceType ToAbsenceType(string s) => s switch
    {
        "VACATION" => AbsenceType.Vacation,
        "SICK" => AbsenceType.Sick,
        _ => AbsenceType.Other,
    };
}
