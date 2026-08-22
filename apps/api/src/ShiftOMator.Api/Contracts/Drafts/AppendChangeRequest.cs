using System.Text.Json;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Drafts;

/// <summary><c>After</c> is a raw <see cref="JsonElement"/>, not a typed Assignment/
/// Absence/CompDayEntry, because which one it deserializes to depends on
/// <see cref="TargetType"/> — a discriminated payload, the same reasoning
/// <c>DraftChange.BeforeJson</c>/<c>AfterJson</c> use server-side.</summary>
public record AppendChangeRequest(DraftTargetType TargetType, DraftOp Op, string EntityId, JsonElement? After);
