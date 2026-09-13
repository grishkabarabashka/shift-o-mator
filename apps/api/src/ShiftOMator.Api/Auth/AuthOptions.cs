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

    /// <summary>
    /// The app role (see <see cref="ShiftOMator.Domain.AppRole"/>) the stub handler stamps
    /// onto every request when <see cref="Mode"/> is "Stub".
    /// <para>
    /// Empty by default, and it must stay that way: this is an <em>override</em>, and while
    /// it defaulted to "Planner" the stored grants were never read — nobody was ever an
    /// Admin or an Approver, Settings never appeared, and no Approve button rendered.
    /// Nothing reads this property today (<c>Program.cs</c> reads the configuration key
    /// directly), so the default only matters as the trap it once was.
    /// </para>
    /// </summary>
    public string StubRole { get; set; } = string.Empty;

    /// <summary>Which person the stub acts as. Empty lets <see cref="ActorResolver"/>
    /// pick a deterministic one from the roster.</summary>
    public string StubPersonId { get; set; } = string.Empty;
}
