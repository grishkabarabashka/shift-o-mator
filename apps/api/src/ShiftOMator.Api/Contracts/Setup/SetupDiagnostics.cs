using ShiftOMator.Api.Contracts.Auth;

namespace ShiftOMator.Api.Contracts.Setup;

/// <summary>
/// How this server authenticates, as it actually resolved at startup.
///
/// Read-only on purpose, and the reason is worth stating where somebody will look for the
/// missing setter: <see cref="Mode"/> chooses which authentication scheme
/// <c>Program.cs</c> registers, and <see cref="Authority"/> / <see cref="Audience"/> are
/// read by <c>AddJwtBearer</c> — all three before the first request exists. A row cannot
/// re-register middleware, so these are configuration and the wizard can only report them
/// (ADR-0063). <see cref="DirectoryRoles"/> is the one that *is* a row, because nothing at
/// startup needs it.
/// </summary>
public record AuthDiagnostics(
    string Mode,
    string? Authority,
    string? Audience,
    bool DirectoryRoles);

/// <summary>
/// Who the caller turned out to be — the answer the setup wizard never gave, and the
/// reason "my email ended up on somebody I have never heard of" was a mystery rather than
/// a sentence on screen.
///
/// <paramref name="TokenEmail"/> is what arrived in the token; <paramref name="PersonId"/>
/// is who it resolved to, or null when it matches nobody. Both are shown because the
/// interesting case is when they disagree: the address is the thing an administrator has
/// to put on a person for the caller to be anybody at all (ADR-0058).
/// </summary>
public record CallerDiagnostics(
    string? PersonId,
    string? DisplayName,
    string? TokenEmail,
    bool Linked,
    IReadOnlyList<RoleGrant> Grants);

/// <summary>
/// What the system actually contains. Drives the wizard's closing "what is still missing"
/// list, which exists because the Bare preset deliberately leaves a system you cannot yet
/// plan in: one location, one unit, one person who is <c>IsIncluded = false</c>, and no
/// shifts or day configurations at all.
/// </summary>
/// <param name="PlannedPeople">Active and <c>IsIncluded</c> — the ones coverage and
/// auto-populate actually consider. A roster of managers is a roster of nobody.</param>
public record ContentDiagnostics(
    int People,
    int PlannedPeople,
    int Units,
    int Shifts,
    int DayConfigurations);

/// <summary>Whether an explanation model is reachable. Unconfigured is a supported state
/// (ADR-0048), and saying so beats a panel that silently never appears.</summary>
public record AiDiagnostics(string Provider, bool Configured);

/// <summary>
/// Everything the setup wizard — and Settings afterward — needs to say what this system
/// is, who you are in it, and what it still lacks.
/// </summary>
public record SetupDiagnosticsResponse(
    AuthDiagnostics Auth,
    CallerDiagnostics Caller,
    ContentDiagnostics Content,
    AiDiagnostics Ai);
