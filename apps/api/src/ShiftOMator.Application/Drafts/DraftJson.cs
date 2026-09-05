using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShiftOMator.Application.Drafts;

/// <summary>
/// One JSON convention for everything a <see cref="ShiftOMator.Domain.DraftChange"/>
/// snapshots — Before/After payloads and the wire format share it, so a payload written
/// by the client deserializes into the same shape the engines work with.
///
/// NOTE: this convention is no longer load-bearing for conflict detection. It used to be
/// (absences and comp days were compared as serialized text), which meant a change here
/// silently invalidated every open draft. Since ADR-0043 every entity carries a version
/// token, so this is free to evolve.
/// </summary>
public static class DraftJson
{
    // The enum convention has to match the HTTP one (Program.cs): these payloads arrive
    // from the client, so a draft change carrying `"PENDING_APPROVAL"` must deserialize
    // here as well. Note that this format is also what lands in `BeforeJson`/`AfterJson`
    // and history `SnapshotJson` columns — changing it means rows written under the old
    // convention no longer read back their enum fields. That is the same class of break
    // as regenerating `InitialCreate`, and acceptable for the same reason: no production
    // data yet.
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        // AppRole first, for the same reason as in Program.cs: first match wins.
        Converters =
        {
            new JsonStringEnumConverter<ShiftOMator.Domain.AppRole>(),
            new JsonStringEnumConverter(UpperSnakeCaseNamingPolicy.Instance),
        },
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new DraftDomainException("BAD_SNAPSHOT", $"Could not deserialize a {typeof(T).Name} snapshot.");

    public static T DeserializeElement<T>(JsonElement element) =>
        element.Deserialize<T>(Options)
        ?? throw new DraftDomainException("BAD_PAYLOAD", $"Could not deserialize a {typeof(T).Name} payload.");
}
