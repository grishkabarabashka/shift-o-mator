using ShiftOMator.Application;
using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;

namespace ShiftOMator.Api;

/// <summary>
/// Published data with an open draft's uncommitted edits laid on top — what the planner
/// is actually looking at, as opposed to what is published.
///
/// Read-only by nature: publish is where conflicts are enforced (ADR-0015), so a
/// malformed snapshot here is skipped rather than allowed to fail the whole read.
///
/// Every endpoint that answers a question *about the plan on screen* has to go through
/// this. Auto-populate did not, and so proposed cells the planner had already filled by
/// hand in the same draft — a preview that quietly overwrote their work when accepted.
/// </summary>
public static class DraftOverlay
{
    public static (List<Assignment> Assignments, List<Absence> Absences, List<CompDayEntry> CompDays) Apply(
        ScheduleDataset dataset, DraftSession? draft)
    {
        var assignments = dataset.Assignments.ToDictionary(a => a.Id);
        var absences = dataset.Absences.ToDictionary(a => a.Id);
        var compDays = dataset.CompDays.ToDictionary(c => c.Id);
        if (draft is null) return (assignments.Values.ToList(), absences.Values.ToList(), compDays.Values.ToList());

        foreach (var change in draft.Changes.OrderBy(c => c.Seq))
        {
            try
            {
                switch (change.TargetType)
                {
                    case DraftTargetType.Assignment:
                        ApplyOne(assignments, change, a => a.Id);
                        break;
                    case DraftTargetType.Absence:
                        ApplyOne(absences, change, a => a.Id);
                        break;
                    case DraftTargetType.CompDay:
                        ApplyOne(compDays, change, c => c.Id);
                        break;
                }
            }
            catch (DraftDomainException)
            {
                // A malformed snapshot shouldn't break the read of the rest of the plan.
            }
        }
        return (assignments.Values.ToList(), absences.Values.ToList(), compDays.Values.ToList());
    }

    private static void ApplyOne<T>(Dictionary<string, T> byId, DraftChange change, Func<T, string> idOf)
    {
        if (change.Op == DraftOp.Delete)
        {
            var before = DraftJson.Deserialize<T>(change.BeforeJson!);
            byId.Remove(idOf(before));
        }
        else
        {
            var after = DraftJson.Deserialize<T>(change.AfterJson!);
            byId[idOf(after)] = after;
        }
    }
}
