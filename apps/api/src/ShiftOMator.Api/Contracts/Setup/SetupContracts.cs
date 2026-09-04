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
/// <param name="Roles">
/// What the founding administrator is granted, globally, on top of <c>Admin</c> — which
/// is always included and cannot be dropped, because a system whose only account cannot
/// reach Settings has no way back.
///
/// It is asked at all because <c>Admin</c> on its own does *not* let you plan: roles are a
/// set and none implies another (ADR-0051). Setting up a system and then finding no way to
/// open a draft is a correct configuration that reads exactly like a broken one, and it
/// was the first thing every new system did.
/// </param>
public record BareSetupRequest(
    string LocationName,
    string TimeZone,
    string HolidayCalendarKey,
    string UnitName,
    UnitKind UnitKind,
    string? DisplayName,
    string? Email,
    IReadOnlyList<AppRole>? Roles = null);

/// <summary>The whole of what the wizard submits: which preset, the Bare preset's fields
/// when it is one, and the one access setting that is a row rather than configuration.
/// </summary>
/// <param name="DirectoryRoles">
/// Honour Entra ID app roles in addition to the stored grants (ADR-0062, ADR-0063). Off
/// unless asked for: a directory grant does not appear on Settings → Roles and cannot be
/// revoked from the product. Changeable afterward — this only picks the starting value.
/// </param>
public record SetupRequest(SetupPreset Preset, BareSetupRequest? Bare, bool DirectoryRoles = false);

public record SetupResponse(SetupPreset Preset, string? AdminPersonId, string? AdminDisplayName);
