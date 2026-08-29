using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>Everything an engine might need in one bag — mirrors domain/types.ts's
/// ScheduleDataset (ReferenceData + PlanData + history).</summary>
public class ScheduleDataset
{
    public List<Location> Locations { get; init; } = [];
    public List<Holiday> Holidays { get; init; } = [];
    public List<PlanningUnit> Units { get; init; } = [];
    public List<Shift> Shifts { get; init; } = [];
    public List<DayConfiguration> DayConfigurations { get; init; } = [];
    public List<Person> People { get; init; } = [];
    public List<AbsenceCapacityRule> AbsenceCapacityRules { get; init; } = [];
    /// <summary>Kinds of non-working day, as data (ADR-0049).</summary>
    public List<EventType> EventTypes { get; init; } = [];

    public List<Assignment> Assignments { get; init; } = [];
    public List<Absence> Absences { get; init; } = [];
    public List<CompDayEntry> CompDays { get; init; } = [];
    /// <summary>Where people work (ADR-0043). Read by no coverage or validation engine —
    /// presence is orthogonal to whether a shift is filled — but carried here so the
    /// schedule response can project it alongside the plan.</summary>
    public List<PresenceRecord> Presence { get; init; } = [];
    public List<Acknowledgement> Acknowledgements { get; init; } = [];
    /// <summary>
    /// Deliberately empty on every load path (ADR-0042): no engine reads it, and it was
    /// the one unbounded table being pulled into memory on every schedule request.
    /// Audit is served by <c>GET /api/history</c> straight from the database.
    /// </summary>
    public List<ChangeHistoryEntry> History { get; init; } = [];
}
