using ShiftOMator.Application;
using ShiftOMator.Domain;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// Port of domain/testkit.ts. Fixtures don't belong here — they're big and change; a
/// test should prove one rule against data that fits entirely in the test itself.
/// </summary>
public static class TestFixtures
{
    private static readonly List<IsoWeekday> Weekend = [IsoWeekday.Saturday, IsoWeekday.Sunday];

    public static readonly Location NyLocation = new()
    {
        Id = "loc-ny",
        Name = "New York",
        Country = "United States",
        TimeZone = "America/New_York",
        HolidayCalendarKey = "US",
        WeekendDays = [.. Weekend],
    };

    public static readonly Location PuneLocation = new()
    {
        Id = "loc-pune",
        Name = "Pune",
        Country = "India",
        TimeZone = "Asia/Kolkata",
        HolidayCalendarKey = "IN",
        WeekendDays = [.. Weekend],
    };

    public static readonly CompOffPolicy TestCompOffPolicy = new()
    {
        WindowBeforeDays = 14,
        WindowAfterDays = 14,
        ExcludedWeekdays = [IsoWeekday.Monday, IsoWeekday.Friday],
        AgingThresholdDays = 14,
        RequiresApprovalWhenNoSlot = true,
    };

    public static readonly PlanningUnit TestUnit = new()
    {
        Id = "unit-1",
        Name = "Test unit",
        Kind = UnitKind.Region,
        GroupBy = GroupBy.Location,
        PrimaryLocationId = NyLocation.Id,
        LocationIds = [NyLocation.Id, PuneLocation.Id],
        CompOffPolicy = TestCompOffPolicy,
    };

    public static readonly Shift LeadRole = new()
    {
        Id = "r-lead",
        UnitId = TestUnit.Id,
        Code = "Lead",
        Label = "Shift lead",
        Color = "#3f6fb5",
        Hotkey = "l",
        TimeZone = "America/New_York",
        Start = new TimeOnly(7, 0),
        End = new TimeOnly(15, 0),
        CrossesMidnight = false,
        BreakMinutes = 60,
        CountsAsCoverage = true,
        EditableTime = false,
    };

    public static readonly Shift NightRole = new()
    {
        Id = "r-night",
        UnitId = TestUnit.Id,
        Code = "Night",
        Label = "Night cover",
        Color = "#5c4a7d",
        Hotkey = "n",
        TimeZone = "America/New_York",
        Start = new TimeOnly(22, 0),
        End = new TimeOnly(6, 0),
        CrossesMidnight = true,
        BreakMinutes = 0,
        CountsAsCoverage = true,
        EditableTime = false,
    };

    public static DayConfiguration MakeDayConfig(
        string id,
        DayConfigKey key,
        List<IsoWeekday>? weekdays = null,
        DateOnly? effectiveFrom = null,
        List<ShiftRequirement>? roleRequirements = null,
        string? unitId = null,
        DateOnly? date = null)
    {
        var config = new DayConfiguration
        {
            Id = id,
            UnitId = unitId ?? TestUnit.Id,
            Key = key,
            Weekdays = weekdays ?? (key == DayConfigKey.Weekend
                ? [IsoWeekday.Saturday, IsoWeekday.Sunday]
                : [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday]),
            EffectiveFrom = effectiveFrom ?? new DateOnly(2020, 1, 1),
            Date = date,
        };
        foreach (var r in roleRequirements ?? [])
        {
            r.DayConfigurationId = id;
            config.ShiftRequirements.Add(r);
        }
        return config;
    }

    public static Person MakePerson(
        string id,
        string? displayName = null,
        string? unitId = null,
        string? locationId = null,
        List<ShiftEligibility>? eligibility = null,
        List<IsoWeekday>? availableWeekdays = null,
        bool weekendEligible = true,
        bool isIncluded = true,
        string? defaultRoleId = null,
        PersonConstraints? constraints = null,
        PersonPreferences? preferences = null,
        OrgCategory orgCategory = OrgCategory.Support)
    {
        var person = new Person
        {
            Id = id,
            DisplayName = displayName ?? id,
            Initials = id.Length >= 2 ? id[..2].ToUpperInvariant() : id.ToUpperInvariant(),
            UnitId = unitId ?? TestUnit.Id,
            LocationId = locationId ?? NyLocation.Id,
            OrgCategory = orgCategory,
            IsActive = true,
            IsIncluded = isIncluded,
            AvailableWeekdays = availableWeekdays ??
                [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday,
                 IsoWeekday.Friday, IsoWeekday.Saturday, IsoWeekday.Sunday],
            DefaultShiftId = defaultRoleId,
            WeekendEligible = weekendEligible,
            Constraints = constraints ?? new PersonConstraints { MinRestHours = 11, MaxConsecutiveDays = 6 },
            Preferences = preferences,
            CalendarToken = $"tok-{id}",
        };
        foreach (var e in eligibility ?? [new ShiftEligibility { PersonId = "", ShiftId = LeadRole.Id, TargetShare = 1 }])
        {
            e.PersonId = id;
            person.Eligibility.Add(e);
        }
        return person;
    }

    private static int _assignmentSeq;

    public static Assignment MakeAssignment(
        string personId,
        string shiftId,
        DateOnly date,
        bool isWeekend = false,
        AssignmentSource source = AssignmentSource.Manual,
        int version = 1,
        string? id = null)
    {
        _assignmentSeq++;
        return new Assignment
        {
            Id = id ?? $"as-{_assignmentSeq}",
            PersonId = personId,
            Date = date,
            UnitId = TestUnit.Id,
            ContentKind = AssignmentContentKind.Shift,
            ShiftId = shiftId,
            IsWeekend = isWeekend,
            Source = source,
            Version = version,
            CreatedBy = "p-planner",
            CreatedAt = DateTimeOffset.Parse("2026-01-01T00:00:00Z"),
        };
    }

    public static Assignment MakeMarkerAssignment(string personId, RosterMarker marker, DateOnly date) => new()
    {
        Id = $"as-marker-{++_assignmentSeq}",
        PersonId = personId,
        Date = date,
        UnitId = TestUnit.Id,
        ContentKind = AssignmentContentKind.Marker,
        Marker = marker,
        IsWeekend = false,
        Source = AssignmentSource.Manual,
        Version = 1,
        CreatedBy = "p-planner",
        CreatedAt = DateTimeOffset.Parse("2026-01-01T00:00:00Z"),
    };

    public static ScheduleDataset MakeDataset(
        List<Location>? locations = null,
        List<Holiday>? holidays = null,
        List<PlanningUnit>? units = null,
        List<Shift>? shifts = null,
        List<DayConfiguration>? dayConfigurations = null,
        List<Person>? people = null,
        List<Assignment>? assignments = null,
        List<Absence>? absences = null,
        List<CompDayEntry>? compDays = null,
        List<AbsenceCapacityRule>? absenceCapacityRules = null) => new()
    {
        Locations = locations ?? [NyLocation, PuneLocation],
        Holidays = holidays ?? [],
        Units = units ?? [TestUnit],
        Shifts = shifts ?? [LeadRole, NightRole],
        DayConfigurations = dayConfigurations ?? [],
        People = people ?? [MakePerson("p-1")],
        AbsenceCapacityRules = absenceCapacityRules ?? [],
        Assignments = assignments ?? [],
        Absences = absences ?? [],
        CompDays = compDays ?? [],
        Acknowledgements = [],
        History = [],
    };

    public static DatasetIndex BuildIndex(ScheduleDataset dataset) => DatasetIndex.Build(dataset);
}
