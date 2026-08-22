using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShiftOMator.Application.Drafts;

/// <summary>
/// One JSON convention for everything a <see cref="ShiftOMator.Domain.DraftChange"/>
/// snapshots — Before/After payloads and later the wire format share it, so a snapshot
/// captured at append time compares byte-for-byte against the same entity reserialized
/// at publish time (the conflict-detection strategy for entities with no version
/// column — see DraftService.Publish remarks).
/// </summary>
public static class DraftJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new DraftDomainException("BAD_SNAPSHOT", $"Could not deserialize a {typeof(T).Name} snapshot.");

    public static T DeserializeElement<T>(JsonElement element) =>
        element.Deserialize<T>(Options)
        ?? throw new DraftDomainException("BAD_PAYLOAD", $"Could not deserialize a {typeof(T).Name} payload.");
}
