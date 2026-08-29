using System.Text.Json;
using ShiftOMator.Application.Drafts;

namespace ShiftOMator.Api.Requests;

/// <summary>
/// The type-specific half of a request.
///
/// WHY a JSON column rather than columns per request type: the whole point of
/// configurable request types (ADR-0047) is that adding one is data, not a deployment —
/// and a nullable column per possible field would reintroduce exactly the schema change
/// this avoids. The fields the *system* acts on — subject, dates, unit — are real
/// columns; only the detail lives here.
/// </summary>
public sealed record RequestPayload(
    string? SiteLocationId = null,
    string? SiteLabel = null,
    /// <summary>Which accrual a comp-day placement is about (ADR-0052). The date being
    /// asked for is the request's own From/To — the link to the accrual is what needs
    /// carrying, so "where did this day off come from" survives the placement.</summary>
    string? CompDayId = null)
{
    public static readonly RequestPayload Empty = new(null, null, null);

    public static RequestPayload Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Empty;
        try
        {
            return JsonSerializer.Deserialize<RequestPayload>(json, DraftJson.Options) ?? Empty;
        }
        catch (JsonException)
        {
            // A malformed payload must not stop an approved request from being recorded:
            // the dates and the subject — the parts that matter — are columns.
            return Empty;
        }
    }

    public string? Write() =>
        this == Empty ? null : JsonSerializer.Serialize(this, DraftJson.Options);
}
