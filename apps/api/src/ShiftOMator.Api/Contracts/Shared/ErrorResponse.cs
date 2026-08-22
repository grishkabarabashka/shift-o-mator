namespace ShiftOMator.Api.Contracts.Shared;

/// <summary>The one <c>{ code, message }</c> shape every non-validation error returns —
/// a typed stand-in for what used to be an anonymous object at each call site, so it
/// shows up as a real schema in OpenAPI/the generated client instead of nothing.</summary>
public record ErrorResponse(string Code, string Message);
