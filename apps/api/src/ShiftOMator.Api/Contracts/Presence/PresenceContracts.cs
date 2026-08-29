using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Presence;

/// <summary>
/// A presence declaration. <c>PersonId</c> is part of the payload because a planner may
/// record it on someone else's behalf; who is *allowed* to is decided by
/// <see cref="Auth.SelfOrPlanner"/>, and who actually did is taken from the token
/// (ADR-0039).
///
/// <c>Version</c> is the token of the record being replaced, omitted when creating.
/// </summary>
public record UpsertPresenceRequest(
    string PersonId,
    string TypeId,
    DateOnly From,
    DateOnly To,
    string? SiteLocationId = null,
    string? SiteLabel = null,
    string? Note = null,
    int? Version = null);

public record PresenceListResponse(IReadOnlyList<PresenceRecord> Presence);
