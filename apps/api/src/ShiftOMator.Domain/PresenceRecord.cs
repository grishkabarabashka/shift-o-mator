namespace ShiftOMator.Domain;

/// <summary>How a presence record got here. <see cref="Request"/> means it came from an
/// approved self-service request; <see cref="Portal"/> from a sync with an external
/// system, if one is ever wired up.</summary>
public enum PresenceSource
{
    Manual,
    Request,
    Import,
    Portal,
}

/// <summary>
/// Where someone works, as a date range (ADR-0043).
///
/// WHY a separate entity and not a field on <see cref="Assignment"/>, which is the
/// obvious first idea:
///
/// 1. Presence exists on days with no assignment. An empty cell means "no roster
///    decision recorded" (ADR-0017); minting an assignment just to carry "remote" would
///    make that cell non-empty and would collide with the unique (person, date) index.
/// 2. Different owner, different write path. Assignments are planner-owned and published
///    through a draft; an employee flipping "remote next Tuesday" would bump
///    <see cref="Assignment.Version"/> and turn every open planner draft into a publish
///    conflict.
/// 3. Presence is declared in blocks — "remote Mon-Wed", "customer site next week" —
///    which is the same shape as <see cref="Absence"/>, not the shape of a cell.
///
/// It does <b>not</b> affect coverage. A remote person on <c>Crew</c> covers <c>Crew</c>;
/// if on-site staffing ever becomes a requirement, that belongs on
/// <see cref="ShiftRequirement"/>, which is already effective-dated.
/// </summary>
public class PresenceRecord
{
    public required string Id { get; set; }
    public required string PersonId { get; set; }
    /// <summary>Which <see cref="PresenceType"/> this is. A row rather than an enum
    /// member (ADR-0054): what counts as a way of working is a question a team answers
    /// for itself.</summary>
    public required string TypeId { get; set; }

    /// <summary>
    /// Which office, for a type that <see cref="PresenceType.NamesALocation"/>.
    ///
    /// NOTE: this reuses <see cref="Location"/> as a *place* without widening what
    /// ADR-0002 says a location is responsible for. Pune-the-holiday-calendar and
    /// Pune-the-office are the same real thing; the calendar responsibility is unchanged.
    /// </summary>
    public string? SiteLocationId { get; set; }

    /// <summary>Free text for a type with no location row behind it — travel, a customer
    /// site, a conference.</summary>
    public string? SiteLabel { get; set; }

    /// <summary>Inclusive, like <see cref="Absence"/>.</summary>
    public required DateOnly From { get; set; }
    public required DateOnly To { get; set; }

    public PresenceSource Source { get; set; }

    /// <summary>Whole day, or one half — "remote in the morning, in the office after
    /// lunch" (ADR-0050).</summary>
    public DayPortion Portion { get; set; } = DayPortion.Full;

    /// <summary>Set when this record materialized from an approved request.</summary>
    public string? RequestId { get; set; }

    /// <summary>Provenance for a future external sync, mirroring <see cref="Absence"/>.</summary>
    public string? ExternalId { get; set; }
    public DateTimeOffset? LastSeenInSyncAt { get; set; }

    public string? Note { get; set; }

    /// <summary>Optimistic-concurrency token (ADR-0043).</summary>
    public int Version { get; set; } = 1;

    public required string CreatedBy { get; set; }
    public required DateTimeOffset CreatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}
