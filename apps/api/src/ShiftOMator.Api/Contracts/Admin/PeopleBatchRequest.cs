namespace ShiftOMator.Api.Contracts.Admin;

/// <summary>
/// One pending edit from Settings → People. <see cref="Kind"/> is
/// <c>create</c> / <c>update</c> / <c>delete</c>; <see cref="Id"/> is required by the last
/// two, <see cref="TempId"/> is the client's own handle for a row that has no id yet and
/// is echoed back with the assigned one.
/// </summary>
public record PeopleBatchOp(string Kind, string? Id, string? TempId, AdminPersonRequest? Person);

/// <summary>
/// Every pending person edit, applied as one unit (ADR-0061).
///
/// The single-row endpoints remain, and one row is still a fine thing to write — this
/// exists because rows in this table are not independent: <c>Email</c> and
/// <c>EmployeeId</c> carry filtered unique indexes, so moving an address from one person
/// to another is two writes that only make sense together.
/// </summary>
public record PeopleBatchRequest(IReadOnlyList<PeopleBatchOp> Ops);

/// <summary>What one applied op turned into — for a create, the id the server assigned.</summary>
public record PeopleBatchResult(int Index, string? TempId, string Id);

public record PeopleBatchResponse(IReadOnlyList<PeopleBatchResult> Results);

/// <summary>
/// Per-op field errors, keyed by the op's index in the request. Nothing was applied:
/// the whole batch rolled back, which is the point of it.
///
/// Deliberately not the flat <c>ValidationErrorResponse</c> the single-row endpoints
/// return: with several rows in flight, "email is taken" without saying *which row*
/// is an error message the client cannot put next to a field.
/// </summary>
public record PeopleBatchErrorResponse(
    string Code,
    IReadOnlyDictionary<int, IReadOnlyDictionary<string, IEnumerable<string>>> Errors);
