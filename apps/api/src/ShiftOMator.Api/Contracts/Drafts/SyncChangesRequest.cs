using System.Text.Json;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Drafts;

/// <summary>
/// Declarative sync of a draft: the client states the desired state of the cells (and
/// absence/comp-day rows) it has touched, and the server keeps exactly one change per
/// key. Contrast with <see cref="AppendChangeRequest"/>, which appends one more entry to
/// a log — that made repainting a cell twice inside one draft an <c>UPDATE</c> against a
/// row that does not exist in published data yet (a 400 that silently dropped the rest of
/// the client's batch).
/// </summary>
public record SyncChangesRequest(IReadOnlyList<SyncChangeItem> Changes);

/// <summary>
/// <paramref name="Key"/> identifies the thing being synced, not the row: for an
/// assignment it is the cell (<c>personId|yyyy-MM-dd</c>, the same shape as
/// <c>DatasetIndex.CellKey</c>), because "one assignment per (person, date)" makes the
/// cell the real identity; for an absence or a comp day it is the entity id.
///
/// <paramref name="After"/> is the desired state, or <c>null</c> to mean "this cell ends
/// up empty". The op (create/update/delete) is derived server-side by comparing against
/// published data — the client never has to guess it, which is what went wrong before.
/// </summary>
public record SyncChangeItem(DraftTargetType TargetType, string Key, JsonElement? After);
