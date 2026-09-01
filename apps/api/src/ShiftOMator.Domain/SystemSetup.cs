namespace ShiftOMator.Domain;

/// <summary>Which starting content a database was given (ADR-0059).</summary>
public enum SetupPreset
{
    /// <summary>One location, one unit, the person who ran setup as its global Admin.
    /// Everything else is typed in on Settings afterward.</summary>
    Bare,

    /// <summary>The fixture entire: locations, holidays, four units, the trimmed roster,
    /// shifts, day configurations, absence-capacity rules, and the demo plan.</summary>
    Demo,
}

/// <summary>
/// Whether this system has been set up, and how (ADR-0059).
///
/// One row, fixed id. Its presence is the whole of "this system has content" — not an
/// inferred condition like "no planning units exist", which a partially written database
/// would satisfy and reopen the wizard on top of itself. The fixed primary key is also
/// what makes a concurrent second call to <c>POST /api/setup</c> fail on a duplicate key
/// rather than run twice.
/// </summary>
public class SystemSetup
{
    /// <summary>Always 1. Not a natural key — there is exactly one row, ever.</summary>
    public int Id { get; set; } = 1;

    public required SetupPreset Preset { get; set; }

    /// <summary>Null when nobody was signed in yet to attribute it to — Stub mode without
    /// a display name, or a preset that created nobody by that name.</summary>
    public string? CompletedByPersonId { get; set; }

    public required DateTimeOffset CompletedAt { get; set; }
}
