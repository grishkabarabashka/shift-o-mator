using System.Text;
using System.Text.Json;

namespace ShiftOMator.Application;

/// <summary>
/// <c>PendingApproval</c> → <c>PENDING_APPROVAL</c>. Applied to enums only.
///
/// WHY this exists: the client's domain (<c>apps/web/src/domain/types.ts</c>) writes every
/// enum in UPPER_SNAKE, and the wire used to write them in camelCase. Reconciling those two
/// conventions cost about a thousand lines in <c>apps/web/src/api/mapping.ts</c> — roughly
/// thirty hand-written <c>xxxFromWire</c>/<c>xxxToWire</c> functions that re-listed every
/// field of every entity so they could convert two or three enum strings along the way.
/// Every new field meant editing three places, and a field forgotten in a mapper was
/// <c>undefined</c> at runtime rather than an error at build time.
///
/// The two conventions had to meet somewhere. They meet here, because this is the cheap
/// side: enum wire format is one serializer setting, whereas the client's side of it was
/// about two hundred string comparisons spread through the UI. Naming policies are not a
/// statement about which convention is better — only about which one is a setting and
/// which one is code.
///
/// Property names are untouched and stay camelCase.
/// </summary>
public sealed class UpperSnakeCaseNamingPolicy : JsonNamingPolicy
{
    public static readonly UpperSnakeCaseNamingPolicy Instance = new();

    private UpperSnakeCaseNamingPolicy() { }

    public override string ConvertName(string name)
    {
        if (string.IsNullOrEmpty(name)) return name;

        var builder = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            // An underscore goes before an upper-case letter that starts a new word.
            // `i > 0` keeps the leading letter clean; the lower-case predecessor test is
            // what stops `OK` or an acronym from becoming `O_K`.
            if (i > 0 && char.IsUpper(c) && !char.IsUpper(name[i - 1]))
            {
                builder.Append('_');
            }
            builder.Append(char.ToUpperInvariant(c));
        }
        return builder.ToString();
    }
}
