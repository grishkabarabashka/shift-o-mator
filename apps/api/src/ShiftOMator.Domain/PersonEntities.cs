namespace ShiftOMator.Domain;

/// <summary>Target share is the fairness metric, not a boolean flag (ADR-0006).</summary>
public class ShiftEligibility
{
    public int Id { get; set; }
    public required string PersonId { get; set; }
    public required string ShiftId { get; set; }
    public double TargetShare { get; set; }
    public int? MinPerWeek { get; set; }
    public int? MaxPerWeek { get; set; }
}

public class PersonConstraints
{
    public int MinRestHours { get; set; }
    public int MaxConsecutiveDays { get; set; }
    public int? MaxWeekendsPerQuarter { get; set; }
}

public class PersonPreferences
{
    public List<IsoWeekday> AvoidsWeekdays { get; set; } = [];
    public List<string> PreferredPartnerIds { get; set; } = [];
    public List<DateOnly> BlackoutDates { get; set; } = [];
    public string? Note { get; set; }
}

/// <summary>No separate "work pattern" entity — DefaultShiftId/AvailableWeekdays are read
/// only by auto-populate (ADR-0005).</summary>
public class Person
{
    public required string Id { get; set; }
    public required string DisplayName { get; set; }
    public required string Initials { get; set; }
    public string? EmployeeId { get; set; }
    /// <summary>Which rules apply and whose screen this person is planned on — one axis
    /// now, not two (Region deleted).</summary>
    public required string UnitId { get; set; }
    public required string LocationId { get; set; }
    public OrgCategory OrgCategory { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>Participates in planning at all. Managers: false.</summary>
    public bool IsIncluded { get; set; } = true;
    public List<IsoWeekday> AvailableWeekdays { get; set; } = [];
    public string? DefaultShiftId { get; set; }
    public bool WeekendEligible { get; set; }
    public PersonConstraints Constraints { get; set; } = new();
    public PersonPreferences? Preferences { get; set; }
    public required string CalendarToken { get; set; }

    public List<ShiftEligibility> Eligibility { get; set; } = [];
}
