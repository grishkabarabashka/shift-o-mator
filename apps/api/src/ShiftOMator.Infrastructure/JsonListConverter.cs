using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ShiftOMator.Infrastructure;

/// <summary>
/// A `List&lt;T&gt;` column stored as a JSON string. EF Core 8's native "primitive
/// collections" need a JSON column type that isn't uniformly available across every
/// SQL Server edition this might run against; a plain nvarchar(max) + JSON round-trip
/// is boring and works everywhere, and every list here (weekend days, location ids,
/// eligibility shift ids) is small and read as a whole, never queried element-by-element.
/// </summary>
public static class JsonListConverter
{
    public static ValueConverter<List<T>, string> For<T>() =>
        new(
            list => JsonSerializer.Serialize(list, JsonOptions),
            json => JsonSerializer.Deserialize<List<T>>(json, JsonOptions) ?? new List<T>());

    public static ValueComparer<List<T>> ComparerFor<T>() =>
        new(
            (a, b) => (a ?? new()).SequenceEqual(b ?? new()),
            list => list.Aggregate(0, (hash, item) => HashCode.Combine(hash, item!.GetHashCode())),
            list => list.ToList());

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
