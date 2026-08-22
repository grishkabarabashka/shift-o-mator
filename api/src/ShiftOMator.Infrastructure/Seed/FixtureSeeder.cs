using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShiftOMator.Application;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure.Seed;

/// <summary>
/// Seeds from `fixture-dataset.json`, a byte-for-byte export of the TypeScript client's
/// own `domain/fixtures.ts` (`scheduleRepository.exportJson()`) rather than a
/// hand-transcription of it. Two implementations of "76 people, real role codes and
/// minimums" drift the moment someone fixes a typo in one and not the other; one export
/// can't drift from itself. Regenerate by running `npx tsx` against a small script that
/// calls `createFixtureDataset()` and writes the result here — see Docs/12-architecture.md.
///
/// Reference data (regions, locations, roles, day configurations, holidays, people, ...)
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
        if (await db.Regions.AnyAsync(ct)) return;

        var dataset = BuildScheduleDataset(includeDemoData);

        db.Locations.AddRange(dataset.Locations);
        db.Holidays.AddRange(dataset.Holidays);
        db.Regions.AddRange(dataset.Regions);
        db.PlanningUnits.AddRange(dataset.Units);
        db.Shifts.AddRange(dataset.Shifts);
        db.Roles.AddRange(dataset.Roles);
        db.DayConfigurations.AddRange(dataset.DayConfigurations);
        db.People.AddRange(dataset.People);
        db.AbsenceCapacityRules.AddRange(dataset.AbsenceCapacityRules);

        if (includeDemoData)
        {
            db.Assignments.AddRange(dataset.Assignments);
            db.Absences.AddRange(dataset.Absences);
            db.CompDayEntries.AddRange(dataset.CompDays);
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// The same mapping <see cref="SeedAsync"/> uses, without touching a DbContext —
    /// for the engine differential test, which compares this dataset's coverage/issue
    /// output against the TypeScript client's own output over identical data and needs
    /// no database to do it.
    /// </summary>
    public static ScheduleDataset BuildScheduleDataset(bool includeDemoData)
    {
        var dataset = LoadDataset();

        var regions = dataset.Regions.Select(r => new Region
        {
            Id = r.Id,
            Name = r.Name,
            PrimaryTimeZone = r.PrimaryTimeZone,
            PrimaryLocationId = r.PrimaryLocationId,
            LocationIds = [.. r.LocationIds],
            CompOffPolicy = new CompOffPolicy
            {
                WindowBeforeDays = r.CompOffPolicy.WindowBeforeDays,
                WindowAfterDays = r.CompOffPolicy.WindowAfterDays,
                ExcludedWeekdays = [.. r.CompOffPolicy.ExcludedWeekdays.Select(ToWeekday)],
                AgingThresholdDays = r.CompOffPolicy.AgingThresholdDays,
                RequiresApprovalWhenNoSlot = r.CompOffPolicy.RequiresApprovalWhenNoSlot,
            },
        }).ToList();

        var units = dataset.Units.Select(u => new PlanningUnit
        {
            Id = u.Id,
            Name = u.Name,
            Kind = u.Kind == "REGION" ? UnitKind.Region : UnitKind.CrossRegion,
            RegionId = u.RegionId,
            GroupBy = u.GroupBy switch
            {
                "LOCATION" => GroupBy.Location,
                "REGION" => GroupBy.Region,
                _ => GroupBy.OrgCategory,
            },
        }).ToList();

        var shifts = dataset.Shifts.Select(s => new ShiftDefinition
        {
            Id = s.Id,
            RegionId = s.RegionId,
            Code = s.Code,
            Name = s.Name,
            TimeZone = s.TimeZone,
            Start = TimeOnly.Parse(s.Start, CultureInfo.InvariantCulture),
            End = TimeOnly.Parse(s.End, CultureInfo.InvariantCulture),
            CrossesMidnight = s.CrossesMidnight,
            BreakMinutes = s.BreakMinutes,
        }).ToList();

        var roles = dataset.Roles.Select(r => new ShiftRole
        {
            Id = r.Id,
            RegionId = r.RegionId,
            Code = r.Code,
            Label = r.Label,
            Description = r.Description,
            Color = r.Color,
            Hotkey = r.Hotkey,
            TimeZone = r.TimeZone,
            Start = TimeOnly.Parse(r.Start, CultureInfo.InvariantCulture),
            End = TimeOnly.Parse(r.End, CultureInfo.InvariantCulture),
            CrossesMidnight = r.CrossesMidnight,
            BreakMinutes = r.BreakMinutes,
            CountsAsCoverage = r.CountsAsCoverage,
            EditableTime = r.EditableTime,
        }).ToList();

        var dayConfigurations = dataset.DayConfigurations.Select(c => new DayConfiguration
        {
            Id = c.Id,
            RegionId = c.RegionId,
            Key = ToDayConfigKey(c.Key),
            Weekdays = [.. c.Weekdays.Select(ToWeekday)],
            Date = c.Date is null ? null : DateOnly.Parse(c.Date, CultureInfo.InvariantCulture),
            Label = c.Label,
            EffectiveFrom = DateOnly.Parse(c.EffectiveFrom, CultureInfo.InvariantCulture),
            RoleRequirements =
            [
                .. c.RoleRequirements.Select(rr => new RoleRequirement
                {
                    DayConfigurationId = c.Id,
                    RoleId = rr.RoleId,
                    Min = rr.Min,
                    Max = rr.Max,
                    IsDefault = rr.IsDefault,
                }),
            ],
        }).ToList();

        var people = dataset.People.Select(p => new Person
        {
            Id = p.Id,
            DisplayName = p.DisplayName,
            Initials = p.Initials,
            EmployeeId = p.EmployeeId,
            RegionId = p.RegionId,
            UnitId = p.UnitId,
            LocationId = p.LocationId,
            DefaultShiftId = p.DefaultShiftId,
            OrgCategory = ToOrgCategory(p.OrgCategory),
            IsActive = p.IsActive,
            IsIncluded = p.IsIncluded,
            AvailableWeekdays = [.. p.AvailableWeekdays.Select(ToWeekday)],
            DefaultRoleId = p.DefaultRoleId,
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
                .. p.Eligibility.Select(e => new RoleEligibility
                {
                    PersonId = p.Id,
                    RoleId = e.RoleId,
                    TargetShare = e.TargetShare,
                    MinPerWeek = e.MinPerWeek,
                    MaxPerWeek = e.MaxPerWeek,
                }),
            ],
        }).ToList();

        var absenceCapacityRules = dataset.AbsenceCapacityRules.Select(r => new AbsenceCapacityRule
        {
            Id = r.Id,
            RegionId = r.RegionId,
            ScopeKind = r.Scope.Kind == "REGION" ? AbsenceCapacityScopeKind.Region : AbsenceCapacityScopeKind.RolePool,
            ScopeRoleId = r.Scope.RoleId,
            DurationBucket = r.DurationBucket == "LONG" ? AbsenceDurationBucket.Long : AbsenceDurationBucket.Short,
            LongThresholdWorkdays = r.LongThresholdWorkdays,
            MaxConcurrent = r.MaxConcurrent,
            CountsTypes = [.. r.CountsTypes.Select(ToAbsenceType)],
            CountsCompDays = r.CountsCompDays,
        }).ToList();

        return new ScheduleDataset
        {
            Locations = [.. dataset.Locations.Select(ToLocation)],
            Holidays = [.. dataset.Holidays.Select(ToHoliday)],
            Regions = regions,
            Units = units,
            Shifts = shifts,
            Roles = roles,
            DayConfigurations = dayConfigurations,
            People = people,
            AbsenceCapacityRules = absenceCapacityRules,
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

    private static Assignment ToAssignment(SeedAssignment a) => new()
    {
        Id = a.Id,
        PersonId = a.PersonId,
        Date = DateOnly.Parse(a.Date, CultureInfo.InvariantCulture),
        RegionId = a.RegionId,
        ContentKind = a.Content.Kind == "ROLE" ? AssignmentContentKind.Role : AssignmentContentKind.Marker,
        RoleId = a.Content.RoleId,
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
