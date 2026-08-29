namespace ShiftOMator.Api.Contracts.History;

/// <summary>What kind of event a timeline entry is, so the client can group and icon it.</summary>
public enum CellEventKind
{
    AssignmentChanged,
    AbsenceChanged,
    PresenceChanged,
    CompDayChanged,
    RequestSubmitted,
    RequestDecided,
}

/// <summary>
/// One thing that happened to one cell, on one time axis.
///
/// The point of merging request submissions and approval decisions into the same list as
/// the change history is the question people actually ask: was the leave request in
/// before or after the rota was changed? Two lists cannot answer that; one ordered list
/// can.
/// </summary>
public record CellEvent(
    DateTimeOffset At,
    CellEventKind Kind,
    string ActorId,
    string? ActorName,
    string Summary,
    string? Comment);

/// <summary><paramref name="PersonId"/> is null for the whole-day view.</summary>
public record CellHistoryResponse(
    string? PersonId,
    DateOnly Date,
    IReadOnlyList<CellEvent> Events);
