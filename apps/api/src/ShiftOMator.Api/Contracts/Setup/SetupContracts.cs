using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Setup;

/// <summary>
/// Whether the setup wizard still needs to run (ADR-0059), and whether it should ask for
/// a display name and email itself. <see cref="StubMode"/> is the only other field —
/// a fingerprint of an unconfigured system is not worth handing to an anonymous caller —
/// and it exists because the wizard needs it before <c>/api/auth/me</c> is reachable at
/// all: that endpoint sits behind the very gate this state answers for.
/// </summary>
public record SetupStateResponse(bool Required, bool StubMode);

/// <summary>
/// The Bare preset's fields. <see cref="DisplayName"/> and <see cref="Email"/> are read
/// from the caller's own token claims outside Stub mode and anything sent here is
/// ignored — the one thing a typo in this field could produce is a system whose only
/// administrator cannot sign in. In Stub mode there are no claims to read, so the wizard
/// asks for them instead.
/// </summary>
public record BareSetupRequest(
    string LocationName,
    string TimeZone,
    string HolidayCalendarKey,
    string UnitName,
    UnitKind UnitKind,
    string? DisplayName,
    string? Email);

/// <summary>The whole of what the wizard submits: which preset, and the Bare preset's
/// fields when it is one.</summary>
public record SetupRequest(SetupPreset Preset, BareSetupRequest? Bare);

public record SetupResponse(SetupPreset Preset, string? AdminPersonId, string? AdminDisplayName);
