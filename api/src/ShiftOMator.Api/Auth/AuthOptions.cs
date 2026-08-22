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
}
