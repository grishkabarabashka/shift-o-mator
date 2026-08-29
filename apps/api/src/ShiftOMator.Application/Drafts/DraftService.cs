using ShiftOMator.Domain;

namespace ShiftOMator.Application.Drafts;

/// <summary>
/// Port of the draft/publish half of ADR-0015. Pure, like the other engines
/// (CLAUDE.md: "Engines are pure, take the current instant as a parameter, and never
/// touch storage") — the caller (an API endpoint, backed by EF Core) is responsible for
/// loading the current <see cref="ScheduleDataset"/> inside a transaction, calling
/// <see cref="Publish"/>, and persisting the result or rolling back on conflict.
///
/// Concurrency strategy: every mutable entity carries a numeric version used as a
/// classic optimistic-concurrency token — <see cref="Assignment.Version"/>,
/// <see cref="Absence.Version"/> and <see cref="CompDayEntry.Version"/> (ADR-0043).
/// A version that moved since the draft was opened is a conflict, not a partial apply:
/// Publish always either applies every change in the draft or none of them.
///
/// Absences and comp days used to be checked by reserializing the live row and comparing
/// it byte-for-byte to the draft's snapshot. That was brittle in both directions — any
/// change to <see cref="DraftJson"/>'s conventions or to property order reported a
/// conflict that had not happened, and two different edits that happened to serialize
/// identically reported none that had.
/// </summary>
public static class DraftService
{
    // -------------------------------------------------------------------------
    // Open / append / remove
    // -------------------------------------------------------------------------

    public static DraftSession Open(string editorPersonId, string unitId, DateOnly rangeFrom, DateOnly rangeTo, DateTimeOffset now) =>
        new()
        {
            Id = Guid.NewGuid().ToString("n"),
            EditorPersonId = editorPersonId,
            UnitId = unitId,
            RangeFrom = rangeFrom,
            RangeTo = rangeTo,
            Status = DraftStatus.Open,
            CreatedAt = now,
            UpdatedAt = now,
        };

    private static void EnsureOpen(DraftSession session)
    {
        if (session.Status != DraftStatus.Open)
            throw new DraftDomainException("DRAFT_NOT_OPEN", $"Draft {session.Id} is {session.Status}, not open.");
    }

    private static DraftChange AppendRaw(
        DraftSession session, DraftTargetType targetType, DraftOp op, string? beforeJson, string? afterJson, DateTimeOffset now)
    {
        EnsureOpen(session);
        var seq = session.Changes.Count == 0 ? 1 : session.Changes.Max(c => c.Seq) + 1;
        var change = new DraftChange
        {
            Id = Guid.NewGuid().ToString("n"),
            DraftSessionId = session.Id,
            Seq = seq,
            At = now,
            TargetType = targetType,
            Op = op,
            BeforeJson = beforeJson,
            AfterJson = afterJson,
        };
        session.Changes.Add(change);
        session.UpdatedAt = now;
        return change;
    }

    /// <summary>
    /// <paramref name="before"/> is whatever the caller read from the live database just
    /// before calling this — not a value trusted from the client — so the snapshot
    /// really does describe "the state the draft was opened against."
    /// </summary>
    public static DraftChange AppendAssignmentChange(
        DraftSession session, DraftOp op, Assignment? before, Assignment? after, DatasetIndex index, DateTimeOffset now)
    {
        EnsureOpen(session);
        switch (op)
        {
            case DraftOp.Create:
                if (after is null) throw new DraftDomainException("AFTER_REQUIRED", "Create requires an after payload.");
                if (before is not null) throw new DraftDomainException("BEFORE_MUST_BE_NULL", "Create must not reference an existing record.");
                ValidateAssignmentDomain(after, index);
                if (index.AssignmentsByCell.ContainsKey(DatasetIndex.CellKey(after.PersonId, after.Date)))
                {
                    // Point 10: exactly one assignment per (person, date) — caught here
                    // as a clean typed error, not left to the unique index to throw.
                    throw new DraftDomainException("CELL_OCCUPIED",
                        $"{after.PersonId} already has an assignment on {after.Date:yyyy-MM-dd}.");
                }
                break;
            case DraftOp.Update:
                if (before is null || after is null) throw new DraftDomainException("BEFORE_AND_AFTER_REQUIRED", "Update requires both before and after.");
                if (before.Id != after.Id) throw new DraftDomainException("ID_MISMATCH", "Before/after id mismatch.");
                ValidateAssignmentDomain(after, index);
                break;
            case DraftOp.Delete:
                if (before is null) throw new DraftDomainException("BEFORE_REQUIRED", "Delete requires a before payload.");
                if (after is not null) throw new DraftDomainException("AFTER_MUST_BE_NULL", "Delete must not include an after payload.");
                break;
            default:
                throw new DraftDomainException("UNKNOWN_OP", $"Unknown op {op}.");
        }

        return AppendRaw(session, DraftTargetType.Assignment, op,
            before is null ? null : DraftJson.Serialize(before),
            after is null ? null : DraftJson.Serialize(after), now);
    }

    private static void ValidateAssignmentDomain(Assignment a, DatasetIndex index)
    {
        if (!index.People.TryGetValue(a.PersonId, out var person))
            throw new DraftDomainException("PERSON_NOT_FOUND", $"Person {a.PersonId} does not exist.");


        if (a.ShiftId is null) throw new DraftDomainException("SHIFT_REQUIRED", "A shift assignment needs a shiftId.");
        if (!index.Shifts.TryGetValue(a.ShiftId, out var shift))
            throw new DraftDomainException("SHIFT_NOT_FOUND", $"Shift {a.ShiftId} does not exist.");

        // Point 4: a shift belongs to a unit; matching codes across units are
        // coincidental (ADR-0004, narrowed to PlanningUnit) — a person can never be
        // handed a shift from another unit.
        if (shift.UnitId != person.UnitId)
        {
            throw new DraftDomainException("SHIFT_OUTSIDE_UNIT",
                $"Shift {shift.Code} belongs to unit {shift.UnitId}, not {person.UnitId} (ADR-0004).");
        }
    }

    // AppendAbsenceChange is gone (ADR-0052): absences are written directly through
    // /api/absences, or produced by an approved request. They are not part of a rota
    // publication and never were part of the decision one represents.

    public static DraftChange AppendCompDayChange(
        DraftSession session, DraftOp op, CompDayEntry? before, CompDayEntry? after, DatasetIndex index, DateTimeOffset now)
    {
        EnsureOpen(session);
        ValidateGenericOp(op, before, after, "CompDay");
        var subject = after ?? before!;
        if (!index.People.ContainsKey(subject.PersonId))
            throw new DraftDomainException("PERSON_NOT_FOUND", $"Person {subject.PersonId} does not exist.");

        return AppendRaw(session, DraftTargetType.CompDay, op,
            before is null ? null : DraftJson.Serialize(before),
            after is null ? null : DraftJson.Serialize(after), now);
    }

    private static void ValidateGenericOp<T>(DraftOp op, T? before, T? after, string label) where T : class
    {
        switch (op)
        {
            case DraftOp.Create when after is null:
                throw new DraftDomainException("AFTER_REQUIRED", $"Create requires an after payload for {label}.");
            case DraftOp.Create when before is not null:
                throw new DraftDomainException("BEFORE_MUST_BE_NULL", $"Create must not reference an existing {label}.");
            case DraftOp.Update when before is null || after is null:
                throw new DraftDomainException("BEFORE_AND_AFTER_REQUIRED", $"Update requires both before and after for {label}.");
            case DraftOp.Delete when before is null:
                throw new DraftDomainException("BEFORE_REQUIRED", $"Delete requires a before payload for {label}.");
            case DraftOp.Delete when after is not null:
                throw new DraftDomainException("AFTER_MUST_BE_NULL", $"Delete must not include an after payload for {label}.");
        }
    }

    /// <summary>
    /// What a change is *about*, so a later edit of the same thing can replace it instead
    /// of stacking on top of it. An assignment's identity is its cell — one assignment per
    /// (person, date), so two changes on the same cell are two versions of one decision,
    /// never two decisions. Comp days are identified by row id.
    /// </summary>
    public static string KeyOf(DraftChange change)
    {
        var json = change.AfterJson ?? change.BeforeJson;
        if (json is null) return change.Id;

        return change.TargetType switch
        {
            DraftTargetType.Assignment => AssignmentKeyOf(DraftJson.Deserialize<Assignment>(json)),
            DraftTargetType.CompDay => DraftJson.Deserialize<CompDayEntry>(json).Id,
            _ => change.Id,
        };
    }

    public static string AssignmentKeyOf(Assignment assignment) =>
        DatasetIndex.CellKey(assignment.PersonId, assignment.Date);

    /// <summary>
    /// Drops every change the draft holds about <paramref name="key"/>, returning them so
    /// the caller can delete the rows. The replacement is appended by the caller — this
    /// only clears the slot.
    /// </summary>
    public static IReadOnlyList<DraftChange> TakeChangesForKey(DraftSession session, DraftTargetType targetType, string key)
    {
        EnsureOpen(session);
        var stale = session.Changes.Where(c => c.TargetType == targetType && KeyOf(c) == key).ToList();
        foreach (var change in stale) session.Changes.Remove(change);
        return stale;
    }

    public static void RemoveChange(DraftSession session, string changeId)
    {
        EnsureOpen(session);
        var removed = session.Changes.RemoveAll(c => c.Id == changeId);
        if (removed == 0) throw new DraftDomainException("CHANGE_NOT_FOUND", $"Change {changeId} is not in draft {session.Id}.");
    }

    public static void Discard(DraftSession session, DateTimeOffset now)
    {
        EnsureOpen(session);
        session.Status = DraftStatus.Discarded;
        session.UpdatedAt = now;
    }

    // -------------------------------------------------------------------------
    // Publish
    // -------------------------------------------------------------------------

    public sealed record ConflictDetail(string ChangeId, DraftTargetType TargetType, string EntityId, string Reason);

    public sealed record PublishOutcome(
        bool Success,
        IReadOnlyList<Assignment> Assignments,
        IReadOnlyList<Absence> Absences,
        IReadOnlyList<CompDayEntry> CompDays,
        IReadOnlyList<ChangeHistoryEntry> History,
        IReadOnlyList<CompDayEntry> GeneratedCompDays,
        int RemainingGaps,
        IReadOnlyList<ConflictDetail> Conflicts)
    {
        public static PublishOutcome Failed(IReadOnlyList<ConflictDetail> conflicts) =>
            new(false, [], [], [], [], [], 0, conflicts);
    }

    /// <summary>
    /// One serializable transaction, conceptually: revalidates every change against
    /// <paramref name="current"/> — the state of the plan *now*, not when the draft was
    /// opened — and either every change applies or none does. The caller is expected to
    /// have loaded <paramref name="current"/> inside a database transaction with
    /// serializable (or at least repeatable-read) isolation so nothing else can move the
    /// rows underneath this call between the read and the write.
    /// </summary>
    public static PublishOutcome Publish(
        ScheduleDataset current, DatasetIndex index, DraftSession session, string actorId, DateTimeOffset now)
    {
        if (session.Status != DraftStatus.Open)
            return PublishOutcome.Failed([new ConflictDetail(session.Id, DraftTargetType.Assignment, session.Id, $"Draft is {session.Status}, not open.")]);

        var conflicts = new List<ConflictDetail>();
        var ordered = session.Changes.OrderBy(c => c.Seq).ToList();

        // --- Assignments: single pass, working state seeded from `current` -----------
        var assignmentsById = current.Assignments.ToDictionary(a => a.Id);
        var assignmentsByCell = current.Assignments.ToDictionary(a => DatasetIndex.CellKey(a.PersonId, a.Date));
        var history = new List<ChangeHistoryEntry>();
        var touchedDates = new List<DateOnly>();
        var touchedUnits = new HashSet<string>();
        var liveAssignmentIdsThisPublish = new HashSet<string>();

        foreach (var change in ordered.Where(c => c.TargetType == DraftTargetType.Assignment))
        {
            switch (change.Op)
            {
                case DraftOp.Create:
                {
                    var after = DraftJson.Deserialize<Assignment>(change.AfterJson!);
                    var cell = DatasetIndex.CellKey(after.PersonId, after.Date);
                    if (assignmentsByCell.ContainsKey(cell))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, after.Id,
                            $"{after.PersonId} already has an assignment on {after.Date:yyyy-MM-dd} — the cell was filled after this draft was opened."));
                        break;
                    }
                    after.Version = 1;
                    after.CreatedBy = actorId;
                    after.CreatedAt = now;
                    after.UpdatedBy = null;
                    after.UpdatedAt = null;
                    assignmentsById[after.Id] = after;
                    assignmentsByCell[cell] = after;
                    history.Add(MakeHistory(HistoryEntityType.Assignment, after.Id, after.PersonId, HistoryAction.Created, after, actorId, now, after.Date, after.Date));
                    touchedDates.Add(after.Date);
                    touchedUnits.Add(after.UnitId);
                    liveAssignmentIdsThisPublish.Add(after.Id);
                    break;
                }
                case DraftOp.Update:
                {
                    var before = DraftJson.Deserialize<Assignment>(change.BeforeJson!);
                    var after = DraftJson.Deserialize<Assignment>(change.AfterJson!);
                    if (!assignmentsById.TryGetValue(before.Id, out var actual))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, before.Id, "The record was deleted since this draft was opened."));
                        break;
                    }
                    if (actual.Version != before.Version)
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, before.Id,
                            $"The record changed since this draft was opened (now at version {actual.Version})."));
                        break;
                    }
                    // Moving cells is a delete+create in this model — one assignment per
                    // (person, date), so guard the destination cell too.
                    var oldCell = DatasetIndex.CellKey(actual.PersonId, actual.Date);
                    var newCell = DatasetIndex.CellKey(after.PersonId, after.Date);
                    if (newCell != oldCell && assignmentsByCell.ContainsKey(newCell))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, after.Id,
                            $"{after.PersonId} already has an assignment on {after.Date:yyyy-MM-dd}."));
                        break;
                    }
                    after.Version = actual.Version + 1;
                    after.CreatedBy = actual.CreatedBy;
                    after.CreatedAt = actual.CreatedAt;
                    after.UpdatedBy = actorId;
                    after.UpdatedAt = now;
                    assignmentsById[after.Id] = after;
                    assignmentsByCell.Remove(oldCell);
                    assignmentsByCell[newCell] = after;
                    history.Add(MakeHistory(HistoryEntityType.Assignment, after.Id, after.PersonId, HistoryAction.Updated, after, actorId, now, actual.Date, after.Date));
                    touchedDates.Add(actual.Date);
                    touchedDates.Add(after.Date);
                    touchedUnits.Add(actual.UnitId);
                    touchedUnits.Add(after.UnitId);
                    liveAssignmentIdsThisPublish.Add(after.Id);
                    break;
                }
                case DraftOp.Delete:
                {
                    var before = DraftJson.Deserialize<Assignment>(change.BeforeJson!);
                    if (!assignmentsById.TryGetValue(before.Id, out var actual))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, before.Id, "The record was already deleted since this draft was opened."));
                        break;
                    }
                    if (actual.Version != before.Version)
                    {
                        conflicts.Add(new ConflictDetail(change.Id, change.TargetType, before.Id,
                            $"The record changed since this draft was opened (now at version {actual.Version})."));
                        break;
                    }
                    assignmentsById.Remove(before.Id);
                    assignmentsByCell.Remove(DatasetIndex.CellKey(actual.PersonId, actual.Date));
                    history.Add(MakeHistory(HistoryEntityType.Assignment, before.Id, actual.PersonId, HistoryAction.Deleted, (Assignment?)null, actorId, now, actual.Date, actual.Date));
                    touchedDates.Add(actual.Date);
                    touchedUnits.Add(actual.UnitId);
                    liveAssignmentIdsThisPublish.Remove(before.Id);
                    break;
                }
            }
        }

        // --- Comp days: version-token conflict check (ADR-0043) ---------------------
        // Absences used to be checked here too. They are written directly now (ADR-0052),
        // so a publish cannot conflict with one — and the read-only copy below is what the
        // coverage and comp-day recomputation needs.
        var absencesById = current.Absences.ToDictionary(a => a.Id);

        var compDaysById = current.CompDays.ToDictionary(c => c.Id);
        ApplyVersioned(
            ordered.Where(c => c.TargetType == DraftTargetType.CompDay), compDaysById, c => c.Id,
            c => c.Version, (c, v) => c.Version = v, c => c.PersonId,
            c => (c.ActualDate ?? c.ProposedDate ?? c.EarnedForDate, c.ActualDate ?? c.ProposedDate ?? c.EarnedForDate),
            conflicts, history, DraftTargetType.CompDay, HistoryEntityType.CompDay, actorId, now);

        if (conflicts.Count > 0) return PublishOutcome.Failed(conflicts);

        var newAssignments = assignmentsById.Values.ToList();
        var newAbsences = absencesById.Values.ToList();
        var newCompDays = compDaysById.Values.ToList();

        // --- Recompute coverage gaps and comp-day accrual over what was touched ------
        var remainingGaps = 0;
        var generatedCompDays = new List<CompDayEntry>();

        if (touchedUnits.Count > 0)
        {
            var postDataset = new ScheduleDataset
            {
                Locations = current.Locations,
                Holidays = current.Holidays,
                Units = current.Units,
                Shifts = current.Shifts,
                DayConfigurations = current.DayConfigurations,
                People = current.People,
                AbsenceCapacityRules = current.AbsenceCapacityRules,
                Assignments = newAssignments,
                Absences = newAbsences,
                CompDays = newCompDays,
                Acknowledgements = current.Acknowledgements,
                History = current.History,
            };
            var postIndex = DatasetIndex.Build(postDataset);

            var rangeFrom = new[] { session.RangeFrom, touchedDates.Min() }.Min();
            var rangeTo = new[] { session.RangeTo, touchedDates.Max() }.Max();
            var asOf = DateOnly.FromDateTime(now.UtcDateTime);
            var acknowledged = new HashSet<string>();

            foreach (var unitId in touchedUnits)
            {
                var cells = CoverageCalculator.Compute(unitId, rangeFrom, rangeTo, newAssignments, postIndex);
                var issues = Validator.Validate(new Validator.ValidateParams(
                    unitId, rangeFrom, rangeTo, newAssignments, newAbsences, newCompDays, cells,
                    current.AbsenceCapacityRules, postIndex, asOf));
                remainingGaps += Validator.Summarize(issues, acknowledged).Gaps;
            }

            if (liveAssignmentIdsThisPublish.Count > 0)
            {
                var compResult = CompDayService.Propose(new CompDayService.ProposeParams(
                    rangeFrom, rangeTo, newAssignments, newAbsences, newCompDays, postIndex, liveAssignmentIdsThisPublish));
                generatedCompDays = [.. compResult.Added];
                newCompDays = [.. compResult.Entries];
            }
        }

        return new PublishOutcome(true, newAssignments, newAbsences, newCompDays, history, generatedCompDays, remainingGaps, []);
    }

    /// <summary>
    /// The absence/comp-day counterpart of the assignment pass: same all-or-nothing
    /// contract, same optimistic-concurrency token (ADR-0043), and — new in ADR-0041 —
    /// the same audit trail. Before, a published absence change left no history row at
    /// all, so "who cancelled my leave" had no answer anywhere in the system.
    /// </summary>
    private static void ApplyVersioned<T>(
        IEnumerable<DraftChange> changes,
        Dictionary<string, T> byId,
        Func<T, string> idOf,
        Func<T, int> versionOf,
        Action<T, int> setVersion,
        Func<T, string> personOf,
        Func<T, (DateOnly From, DateOnly To)> spanOf,
        List<ConflictDetail> conflicts,
        List<ChangeHistoryEntry> history,
        DraftTargetType targetType,
        HistoryEntityType entityType,
        string actorId,
        DateTimeOffset now)
    {
        foreach (var change in changes)
        {
            switch (change.Op)
            {
                case DraftOp.Create:
                {
                    var after = DraftJson.Deserialize<T>(change.AfterJson!);
                    var id = idOf(after);
                    if (byId.ContainsKey(id))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, targetType, id, "A record with this id was created since this draft was opened."));
                        break;
                    }
                    setVersion(after, 1);
                    byId[id] = after;
                    history.Add(MakeHistory(entityType, id, personOf(after), HistoryAction.Created, after, actorId, now, spanOf(after).From, spanOf(after).To));
                    break;
                }
                case DraftOp.Update:
                {
                    var before = DraftJson.Deserialize<T>(change.BeforeJson!);
                    var after = DraftJson.Deserialize<T>(change.AfterJson!);
                    var id = idOf(before);
                    if (!byId.TryGetValue(id, out var actual))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, targetType, id, "The record was deleted since this draft was opened."));
                        break;
                    }
                    if (versionOf(actual) != versionOf(before))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, targetType, id,
                            $"The record changed since this draft was opened (now at version {versionOf(actual)})."));
                        break;
                    }
                    setVersion(after, versionOf(actual) + 1);
                    byId[id] = after;
                    history.Add(MakeHistory(entityType, id, personOf(after), HistoryAction.Updated, after, actorId, now, spanOf(after).From, spanOf(after).To));
                    break;
                }
                case DraftOp.Delete:
                {
                    var before = DraftJson.Deserialize<T>(change.BeforeJson!);
                    var id = idOf(before);
                    if (!byId.TryGetValue(id, out var actual))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, targetType, id, "The record was already deleted since this draft was opened."));
                        break;
                    }
                    if (versionOf(actual) != versionOf(before))
                    {
                        conflicts.Add(new ConflictDetail(change.Id, targetType, id,
                            $"The record changed since this draft was opened (now at version {versionOf(actual)})."));
                        break;
                    }
                    byId.Remove(id);
                    history.Add(MakeHistory<T>(entityType, id, personOf(actual), HistoryAction.Deleted, default, actorId, now, spanOf(actual).From, spanOf(actual).To));
                    break;
                }
            }
        }
    }

    private static ChangeHistoryEntry MakeHistory<T>(
        HistoryEntityType entityType, string entityId, string? personId, HistoryAction action,
        T? snapshot, string actorId, DateTimeOffset now,
        DateOnly? affectedFrom = null, DateOnly? affectedTo = null) =>
        new()
        {
            Id = Guid.NewGuid().ToString("n"),
            EntityType = entityType,
            EntityId = entityId,
            PersonId = personId,
            AffectedFrom = affectedFrom,
            AffectedTo = affectedTo,
            Action = action,
            SnapshotJson = snapshot is null ? null : DraftJson.Serialize(snapshot),
            ActorId = actorId,
            At = now,
        };
}
