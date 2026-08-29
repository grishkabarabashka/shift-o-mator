using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// What happens to the records already covering a day when a new one arrives for it
/// (ADR-0052).
///
/// WHY they are superseded rather than stacked: approving "remote on Wednesday" over an
/// existing "office Mon–Fri" used to *add* a second record, and the cell then rendered
/// whichever the projection happened to reach last. The day did not change, which is the
/// one thing the approval was for.
///
/// Superseding is a **trim**, not a delete: the untouched days of the old record are still
/// true. An office week with a remote Wednesday punched out of it stays an office week on
/// either side.
///
/// Half-days are respected only where they are unambiguous: a FULL record supersedes
/// anything, and two records with the *same* half supersede each other. A morning and an
/// afternoon are complementary and both survive. Anything finer — a morning punched out of
/// a full day — is not modelled, for the same reason coverage stays whole-day: the shape
/// of the answer would be invented rather than known.
/// </summary>
public static class RangeSupersede
{
    /// <summary>What to do with the existing records.</summary>
    /// <typeparam name="T">The record type — <see cref="Absence"/> or <see cref="PresenceRecord"/>.</typeparam>
    public sealed record Plan<T>(
        IReadOnlyList<T> Removed,
        IReadOnlyList<T> Trimmed,
        IReadOnlyList<(T Source, DateOnly From, DateOnly To)> Split);

    /// <summary>
    /// Works out how <paramref name="existing"/> has to change so that
    /// <paramref name="from"/>..<paramref name="to"/> belongs to the new record.
    ///
    /// The caller applies the plan — this stays pure, so the same arithmetic is testable
    /// without a database and cannot differ between the endpoint and the approval path.
    /// </summary>
    public static Plan<T> Against<T>(
        IReadOnlyList<T> existing,
        DateOnly from,
        DateOnly to,
        DayPortion portion,
        Func<T, DateOnly> getFrom,
        Func<T, DateOnly> getTo,
        Func<T, DayPortion> getPortion,
        Action<T, DateOnly, DateOnly> setRange)
    {
        var removed = new List<T>();
        var trimmed = new List<T>();
        var split = new List<(T, DateOnly, DateOnly)>();

        foreach (var record in existing)
        {
            var recordFrom = getFrom(record);
            var recordTo = getTo(record);

            if (recordTo < from || recordFrom > to) continue;
            if (!Supersedes(portion, getPortion(record))) continue;

            var startsBefore = recordFrom < from;
            var endsAfter = recordTo > to;

            if (startsBefore && endsAfter)
            {
                // The new range punches a hole: the tail becomes a separate record, and
                // the caller creates it.
                split.Add((record, to.AddDays(1), recordTo));
                setRange(record, recordFrom, from.AddDays(-1));
                trimmed.Add(record);
            }
            else if (startsBefore)
            {
                setRange(record, recordFrom, from.AddDays(-1));
                trimmed.Add(record);
            }
            else if (endsAfter)
            {
                setRange(record, to.AddDays(1), recordTo);
                trimmed.Add(record);
            }
            else
            {
                removed.Add(record);
            }
        }

        return new Plan<T>(removed, trimmed, split);
    }

    /// <summary>
    /// A whole day beats anything; two identical halves beat each other.
    ///
    /// A half deliberately does **not** beat a whole day: trimming the day away to make
    /// room for a morning would silently discard the afternoon, which nobody asked to
    /// give up. Both records survive and the cell shows both — honest, and visibly odd,
    /// which is the right outcome for a case the model does not represent.
    /// </summary>
    private static bool Supersedes(DayPortion incoming, DayPortion existing) =>
        incoming == DayPortion.Full || incoming == existing;
}
