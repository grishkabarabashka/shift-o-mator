namespace ShiftOMator.Domain;

/// <summary>Owned value object — has no identity of its own, only ever
/// meaningful attached to a <see cref="Person"/>.</summary>
public class PersonConstraints
{
    public int MinRestHours { get; set; }
    public int MaxConsecutiveDays { get; set; }
    public int? MaxWeekendsPerQuarter { get; set; }
}

/// <summary>Owned value object — has no identity of its own, only ever
/// meaningful attached to a <see cref="Person"/>.</summary>
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
    /// <summary>
    /// The secret in this person's calendar feed URL — the <b>only</b> thing standing
    /// between an unauthenticated subscriber and their schedule, because that is how a
    /// calendar subscription works: Outlook cannot carry a bearer token.
    ///
    /// WHY it is not serialized: <see cref="Person"/> goes out whole on /api/reference, so
    /// without this every signed-in person would be handed everybody else's feed URL. It is
    /// read back only through the caller's own /api/me/calendar-feed, and rotating it is a
    /// button there.
    /// </summary>
    /// WHY not `required`: System.Text.Json refuses a required property it is told to
    /// ignore, and defaulting it is the better shape anyway — a person without a feed
    /// token is not a state this product has.
    [System.Text.Json.Serialization.JsonIgnore]
    public string CalendarToken { get; set; } = NewCalendarToken();

    /// <summary>A feed URL is handed to Outlook, which cannot carry a bearer token, so the
    /// token in it is the whole of the authentication. 256 bits of it.</summary>
    public static string NewCalendarToken() =>
        Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
            .ToLowerInvariant();

    /// <summary>
    /// Where this person works when nothing says otherwise (ADR-0043). The grid renders
    /// presence as a *delta* from this baseline — otherwise every one of ~2500 cells
    /// would carry an "O" and the channel would say nothing.
    /// </summary>
    public string DefaultPresenceTypeId { get; set; } = PresenceTypeIds.Office;

    /// <summary>Which office is the baseline. Usually — but not necessarily — the same
    /// row as <see cref="LocationId"/>, which answers a different question (calendar and
    /// display timezone, ADR-0002).</summary>
    public string? DefaultSiteLocationId { get; set; }

    /// <summary>
    /// Line manager, used by <see cref="ApprovalStrategy.Manager"/> (ADR-0048).
    ///
    /// NOTE: an *input* to routing, not the route itself. A single manager chain cannot
    /// express "leave goes to the line manager, a shift swap goes to the unit's
    /// planners", which is why <see cref="ApprovalRoute"/> exists.
    /// </summary>
    public string? ManagerId { get; set; }

    public List<ShiftEligibility> Eligibility { get; set; } = [];
}
