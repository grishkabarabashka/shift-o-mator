namespace ShiftOMator.Api.Contracts.Shared;

/// <summary>The per-field error shape every <c>/api/admin/*</c> endpoint's 400 returns
/// (<c>AdminValidation.ToBadRequestOrNull</c>) — one entry per invalid field, each a list
/// because a field can fail more than one rule at once.</summary>
public record ValidationErrorResponse(IReadOnlyDictionary<string, IEnumerable<string>> Errors);
