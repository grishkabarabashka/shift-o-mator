namespace ShiftOMator.Api.Contracts.Drafts;

/// <summary>
/// Cells another planner is currently holding an unpublished edit on.
///
/// WHY the product wants this at all: concurrent drafts are allowed on purpose
/// (ADR-0015) and resolve at publish, so nothing here blocks anybody. What was missing is
/// the *warning* — two planners could fill the same week, each unaware, and the first one
/// to publish decided it. A banner saying "somebody else has this period open" is true and
/// useless; naming the cells is what lets the second planner work somewhere else.
/// </summary>
public record StagedCellsResponse(IReadOnlyList<StagedCell> Cells);

/// <summary>One (person, date) staged in somebody else's open draft. Flat and per-cell
/// because that is how the grid indexes: the client keys it the same way it keys the
/// projection.</summary>
public record StagedCell(string PersonId, DateOnly Date, string EditorPersonId, string EditorName);
