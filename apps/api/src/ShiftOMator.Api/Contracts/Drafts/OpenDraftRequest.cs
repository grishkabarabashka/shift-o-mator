namespace ShiftOMator.Api.Contracts.Drafts;

/// <summary>
/// The editor is <b>not</b> a field: it is the authenticated caller (ADR-0039). A draft
/// opened "on behalf of" someone else would publish under their name in the history.
/// </summary>
public record OpenDraftRequest(string UnitId, DateOnly RangeFrom, DateOnly RangeTo);
