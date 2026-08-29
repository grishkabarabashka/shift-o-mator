using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Me;

/// <summary>
/// One person's own rows over a long window — what the My calendar screen draws.
///
/// Deliberately the raw entities and nothing computed. The client already owns the
/// precedence chain that turns them into a day (`engine/cellValue.ts`), and a second
/// projection on the server would be a second answer to "what does this day say" — which
/// is exactly the duplication ADR-0017 exists to prevent.
/// </summary>
public record MyCalendarResponse(
    string PersonId,
    IReadOnlyList<Assignment> Assignments,
    IReadOnlyList<Absence> Absences,
    /// <summary>All of them, not just the ones in the window: an unplaced comp day has no
    /// date to filter on, and placing it is what the screen is for.</summary>
    IReadOnlyList<CompDayEntry> CompDays,
    IReadOnlyList<PresenceRecord> Presence,
    IReadOnlyList<MyPendingRequest> PendingRequests);

/// <summary>A request of the caller's own that has not landed yet. Approved-but-not-applied
/// counts: the decision is made and the row is not written, and the day should say so
/// rather than briefly saying nothing (ADR-0045).</summary>
public record MyPendingRequest(
    string Id,
    string TypeId,
    string TypeLabel,
    DateOnly From,
    DateOnly To,
    DayPortion Portion,
    RequestState State);

/// <summary>The subscription address. The token in it is the only credential, so this is
/// the caller's own and nobody else's.</summary>
public record CalendarFeedResponse(string Url);
