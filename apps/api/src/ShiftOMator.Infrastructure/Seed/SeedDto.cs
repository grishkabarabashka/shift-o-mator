namespace ShiftOMator.Infrastructure.Seed;

// Mirrors the fixture-dataset.json shape hand-maintained for Phase 8 (Region deleted,
// PlanningUnit is the single rule axis) — see FixtureSeeder's remarks for why the seed
// is generated/maintained as one JSON blob rather than hand-transcribed per entity.

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
