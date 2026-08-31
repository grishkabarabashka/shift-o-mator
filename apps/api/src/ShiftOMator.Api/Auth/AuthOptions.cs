namespace ShiftOMator.Api.Auth;

/// <summary>
/// Binds the <c>Auth</c> configuration section. <see cref="Mode"/> is the seam: "Stub"
/// wires <see cref="StubAuthenticationHandler"/>, anything else (e.g. "EntraId") wires
/// real JWT bearer validation instead — see <c>Program.cs</c>. Adding a second real mode
/// later is a new branch there, not a rewrite of every endpoint.
/// </summary>
public class AuthOptions
{
    public const string SectionName = "Auth";

    public string Mode { get; set; } = "Stub";

    /// <summary>The app role (see <see cref="ShiftOMator.Domain.AppRole"/>) the stub
    /// handler stamps onto every request when <see cref="Mode"/> is "Stub".</summary>
    public string StubRole { get; set; } = "Planner";

    /// <summary>Which person the stub acts as. Empty lets <see cref="ActorResolver"/>
    /// pick a deterministic one from the roster.</summary>
    public string StubPersonId { get; set; } = string.Empty;

    /// <summary>
    /// Work email to link to the global admin on a database where nobody can sign in yet
    /// (ADR-0058). Applied at startup and **only** while no person has an email at all, so
    /// it is inert on any running system and safe to leave configured.
    ///
    /// Exists because linking is otherwise circular: you must be signed in to reach the
    /// screen that lets anybody sign in.
    /// </summary>
    public string BootstrapAdminEmail { get; set; } = string.Empty;
}
