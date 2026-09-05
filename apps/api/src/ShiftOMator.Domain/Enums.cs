using System.Text.Json.Serialization;

namespace ShiftOMator.Domain;

/// <summary>ISO weekday, 1 = Monday .. 7 = Sunday — matches Luxon on the client.</summary>
public enum IsoWeekday
{
    Monday = 1,
    Tuesday = 2,
    Wednesday = 3,
    Thursday = 4,
    Friday = 5,
    Saturday = 6,
    Sunday = 7,
}

public enum UnitKind
{
    Region,
    CrossRegion,
}

public enum GroupBy
{
    Location,
    Region,
    OrgCategory,
}

public enum OrgCategory
{
    Support,
    ServiceTransition,
    Management,
}

/// <summary>'date' is reserved and not yet implemented on the client either (ADR-0008).</summary>
public enum DayConfigKey
{
    Weekday,
    Friday,
    Weekend,
    Holiday,
    Date,
}

public enum AssignmentSource
{
    Manual,
    Generated,
    Imported,
}

// RosterMarker (Off / NotScheduled) and AssignmentContentKind are deleted (ADR-0052).
// An assignment is a shift; there is nothing else it can be. The markers existed to
// record "considered, and deliberately not scheduled" as distinct from "nobody has looked
// at this yet" — a distinction the team did not use and which duplicated what a
// non-working calendar day and an absence already said. An engineer who wants to be left
// off a particular day now records the `UNAVAILABLE` event type, which is an absence and
// therefore visible to every screen that already understands absences.

/// <summary>
/// Which half of a day something covers (ADR-0050).
///
/// Deliberately not times. Comparing an AM/PM half against a shift's actual window would
/// need a boundary hour, and any boundary we picked would be invented — so coverage stays
/// whole-day and this drives rendering and conflict wording only.
/// </summary>
public enum DayPortion
{
    Full,
    Morning,
    Afternoon,
}

public enum AbsenceSource
{
    Import,
    Manual,
    Request,
}

public enum CompDayTrigger
{
    Saturday,
    Sunday,
    Holiday,
}

/// <summary>No terminal expiry state on purpose — comp days never expire (ADR-0007).</summary>
public enum CompDayStatus
{
    Proposed,
    Scheduled,
    Taken,
    Declined,
    PendingApproval,
}

public enum CoverageLevel
{
    Gap,
    Thin,
    Ok,
    Over,
}

public enum AbsenceCapacityScopeKind
{
    Unit,
    ShiftPool,
}

public enum AbsenceDurationBucket
{
    Short,
    Long,
}

public enum IssueLevel
{
    Blocking,
    Warning,
    Info,
}

public enum IssueCategory
{
    Gap,
    Conflict,
    Fairness,
    Policy,
}

public enum IssueCode
{
    CoverageGap,
    CoverageThin,
    CoverageOverMax,
    AssignedDuringAbsence,
    AssignedDuringCompDay,
    DoubleAssignment,
    ShiftNotEligible,
    ShiftOutsideRegion,
    ShiftNotInDayConfig,
    AbsenceCapacityExceeded,
    MinRestViolated,
    ConsecutiveDaysExceeded,
    WeekendLoadExceeded,
    UnavailableWeekday,
    PreferenceViolated,
    TargetShareDeviation,
    CompDayAging,
    CompDayPendingApproval,
}

public enum DraftStatus
{
    Open,
    Published,
    Discarded,
}

public enum DraftOp
{
    Create,
    Update,
    Delete,
}

/// <summary>
/// What a draft change is about. **Absence is not here** (ADR-0052): a draft publishes the
/// rota, and time off is decided by approval on its own schedule, by different people.
/// Staging it here meant a sick day sat invisible until an unrelated planner published.
///
/// CompDay stays, because a comp day is *earned by* a weekend shift in the same draft:
/// accruing one for a shift that might still be withdrawn before publication would be
/// crediting work nobody has committed to yet.
/// </summary>
public enum DraftTargetType
{
    Assignment,
    CompDay,
}

public enum HistoryAction
{
    Created,
    Updated,
    Deleted,
}

/// <summary>
/// What somebody is allowed to do. **A set, not a ladder** (ADR-0051).
///
/// WHY the ordinal comparison is gone: it made every higher role a superset of every
/// lower one, so an Admin could assign shifts purely because <c>Admin &gt; Planner</c>.
/// That is not the org: administering settings and planning a rota are different jobs
/// held by different people. Nothing may compare these by <c>(int)</c> — hold the role
/// or you do not.
///
/// Roles are granted per planning unit, or globally; see <see cref="RoleAssignment"/>.
///
/// NOTE: the only enum exempt from the wire's UPPER_SNAKE convention
/// (<see cref="ShiftOMator.Application.UpperSnakeCaseNamingPolicy"/>), so these serialize
/// as <c>Planner</c>, not <c>PLANNER</c>.
///
/// WHY: that convention exists to make the wire match the client's domain, and the client
/// already writes roles in this exact shape — <c>api/mapping.ts</c> never converted them.
/// Renaming them would *create* the mismatch the policy exists to remove. These strings
/// are also the vocabulary of an external system: Entra app roles are declared with these
/// names, and <c>RoleClaimsTransformation</c> parses `roles` claims against them.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<AppRole>))]
public enum AppRole
{
    /// <summary>Read the rota, and self-service on your own row. Everyone has it.</summary>
    Viewer,

    /// <summary>Owns the rota: shifts, markers, comp days, publishing. Owns nothing
    /// else — leave for another person is an approval question, not a planning one.</summary>
    Planner,

    /// <summary>Decides requests raised by people in the unit.</summary>
    Approver,

    /// <summary>Edits configuration. Explicitly **cannot** assign shifts.</summary>
    Admin,
}
