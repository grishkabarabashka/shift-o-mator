namespace ShiftOMator.Domain;

/// <summary>
/// A way of working — the reference row behind "where are you working" (ADR-0043,
/// reopened by ADR-0054).
///
/// This was a closed enum with a row of settings beside it. The two branches that
/// justified the enum are now columns: <see cref="NamesALocation"/> says whether the
/// record points at a <see cref="Location"/> or carries free text, and
/// <see cref="CountsAs"/> says which column of the coverage strip's headcount it lands in.
/// Nothing else in the product ever asked which kind a record was, which is what made the
/// enum removable — and "standby", "conference" or "a customer's office" are exactly the
/// sort of thing a team invents without asking anybody here.
///
/// Presence still never affects coverage, and there is no field here that could make it —
/// for the same reason <see cref="EventType"/> has no coverage flag: if it counts as
/// coverage it is a <see cref="Shift"/>.
/// </summary>
public class PresenceType
{
    public required string Id { get; set; }

    /// <summary>
    /// Whether recording this names one of our offices, or is free text.
    ///
    /// The one behavioural difference the old enum encoded: office was the only member
    /// that pointed at a <see cref="Location"/> row.
    /// </summary>
    public bool NamesALocation { get; set; }

    /// <summary>Which headcount this adds to on the coverage strip. A display grouping —
    /// a new type defaults to <see cref="PresenceGroup.Away"/>, because claiming somebody
    /// is on site is the answer that would mislead.</summary>
    public PresenceGroup CountsAs { get; set; } = PresenceGroup.Away;

    public required string Label { get; set; }

    /// <summary>One or two characters for the grid's presence band — the band is 9px and
    /// there is room for nothing else.</summary>
    public required string Glyph { get; set; }

    public required string Color { get; set; }

    /// <summary>
    /// Whether recording it raises a request instead of writing the day.
    ///
    /// A property of the thing, not of who is asking (ADR-0051): a planner marking
    /// somebody remote asks like anybody else. Remote is the seeded example, because it is
    /// the one the business has an opinion about — but which kinds those are is a local
    /// policy, which is why it is a column and not an `if`.
    /// </summary>
    public bool RequiresApproval { get; set; }

    /// <summary>Retiring a type hides it from the menu without rewriting history:
    /// existing records still name it, and still need its colour and its label. Which is
    /// why DELETE refuses once anything points at it — see the admin endpoint.</summary>
    public bool IsActive { get; set; } = true;

    public int SortOrder { get; set; }
}

/// <summary>
/// The three columns of "on site / remote / away" on the coverage strip.
///
/// WHY a closed set when the types themselves are open: this is a *readout*, not a
/// property of the work. One row of a strip cannot have a column per type an admin
/// invents, and the question it answers — "how many are in a building on Friday" — has
/// exactly these three answers.
/// </summary>
public enum PresenceGroup
{
    OnSite,
    Remote,
    Away,
}

/// <summary>
/// Ids of the seeded presence types.
///
/// WHY they are constants in Domain rather than strings in the seeder: a new person
/// defaults to being in the office, and that default is a domain fact. Only the seeded set
/// is named here — a type an administrator adds has a generated id and nothing in the code
/// refers to it, which is the point of the set being open (ADR-0054).
/// </summary>
public static class PresenceTypeIds
{
    public const string Office = "pt-office";
    public const string Remote = "pt-remote";
    public const string Travel = "pt-travel";
    public const string CustomerSite = "pt-customer-site";
}
