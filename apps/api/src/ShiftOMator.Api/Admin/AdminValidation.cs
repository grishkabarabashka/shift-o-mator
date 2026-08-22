using ShiftOMator.Api.Contracts.Shared;

namespace ShiftOMator.Api.Admin;

/// <summary>
/// One per-field error shape used by every <c>/api/admin/*</c> endpoint, so the client
/// doesn't need a different parser per entity. Wire shape: <c>{ "errors": { "field":
/// ["message", ...] } }</c>, HTTP 400 — deliberately close to ASP.NET's own
/// <c>ValidationProblemDetails.Errors</c> shape without pulling in the MVC validation
/// pipeline (this is minimal APIs, not controllers with model binding attributes).
/// </summary>
public sealed class AdminValidation
{
    private readonly Dictionary<string, List<string>> _errors = new(StringComparer.OrdinalIgnoreCase);

    public bool HasErrors => _errors.Count > 0;

    public AdminValidation Require(string field, string? value, string message = "is required.")
    {
        if (string.IsNullOrWhiteSpace(value)) Add(field, message);
        return this;
    }

    public AdminValidation Require<T>(string field, T? value, string message = "is required.") where T : struct
    {
        if (value is null) Add(field, message);
        return this;
    }

    public AdminValidation Check(string field, bool condition, string message)
    {
        if (!condition) Add(field, message);
        return this;
    }

    public void Add(string field, string message)
    {
        field = CamelCaseLeadingSegment(field);
        if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = [];
        list.Add(message);
    }

    /// <summary>
    /// Callers pass field names via <c>nameof(req.SomeProperty)</c> (PascalCase, the C#
    /// convention) so a rename is a compiler error, but the wire — like every other DTO
    /// in this API — is camelCase. Only the leading segment is normalized (handles
    /// "RegionId" and "ShiftRequirements[0]"; a nested path like "CompOffPolicy.Window..."
    /// keeps its second segment's case, which is close enough for a field-error key
    /// nobody parses beyond "does this string exist").
    /// </summary>
    private static string CamelCaseLeadingSegment(string field) =>
        field.Length > 0 && char.IsUpper(field[0])
            ? char.ToLowerInvariant(field[0]) + field[1..]
            : field;

    public IResult? ToBadRequestOrNull() =>
        HasErrors ? Results.BadRequest(new ValidationErrorResponse(_errors.ToDictionary(kv => kv.Key, kv => kv.Value.AsEnumerable()))) : null;

    public static IResult NotFound(string entity, string id) =>
        Results.NotFound(new NotFoundResponse($"{entity.ToUpperInvariant()}_NOT_FOUND", id));

    /// <summary>A referenced-by-live-data conflict — e.g. deleting a location still used
    /// by a region or a person. 409, not 400: the request itself is well-formed.</summary>
    public static IResult Conflict(string code, string message) =>
        Results.Conflict(new ErrorResponse(code, message));
}
