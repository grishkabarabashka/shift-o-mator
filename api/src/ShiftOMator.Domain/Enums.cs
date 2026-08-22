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

/// <summary>Off = planned day off (Off/W-Off). NotScheduled = explicit "0", not blank.</summary>
public enum RosterMarker
{
    Off,
    NotScheduled,
}

public enum AssignmentContentKind
{
    Role,
    Marker,
}

/// <summary>Training is not an absence — it is the Cover role (ADR-0017).</summary>
public enum AbsenceType
{
    Vacation,
    Sick,
    Other,
}

public enum AbsenceSource
{
    Import,
    Manual,
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
    Region,
    RolePool,
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
    RoleNotEligible,
    RoleOutsideRegion,
    RoleNotInDayConfig,
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

public enum DraftTargetType
{
    Assignment,
    Absence,
    CompDay,
}

public enum HistoryAction
{
    Created,
    Updated,
    Deleted,
}

/// <summary>
/// App-level authorization roles (Phase 4). Ordinal order is the privilege order
/// (Viewer &lt; Planner &lt; Admin) — policies compare by <c>(int)</c>, not by name, so
/// this is a hierarchy, not a flag set. Point 3 (ADR-0020/0025): no regional scoping of
/// write access — a role is global, the control is the audit trail, not a boundary.
/// </summary>
public enum AppRole
{
    Viewer,
    Planner,
    Admin,
}
