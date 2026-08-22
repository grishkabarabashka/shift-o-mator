using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/autoPopulate.ts (Docs/06-generation.md). Four passes, not one rule
/// list:
///   1. minimums — every requirement filled to <see cref="ShiftRequirement.Min"/> by
///      ranking (<see cref="CandidateRanker"/>). What is missing here is a real gap;
///   2. personal defaults — a person carrying an explicit DefaultShiftId gets it, if the
///      day offers that shift and it has room. An exception mechanism, not the norm
///      (ADR-0038): most people have none;
///   3. top-up — on ordinary working days, requirements are filled on towards
///      <see cref="ShiftRequirement.Max"/>. Not a gap when it falls short: above the
///      minimum, an empty slot is spare capacity, not an unmet obligation;
///   4. the day's bulk shift — the requirement marked
///      <see cref="ShiftRequirement.IsDefault"/> with no ceiling takes everyone still
///      free and eligible. This is what fills an ordinary working day, and it is a
///      property of the day configuration, not of a person (ADR-0038).
///
/// **Order is the whole design here.** Every pass that grabs people in bulk runs after
/// every pass that needs a specific person, because the scarce thing is not the shift,
/// it is someone free to work it. Defaults used to run first, and in a unit where
/// everyone carried the same DefaultShiftId (unit-amer: 24 people on `Crew`) that pass
/// consumed the entire team before minimums were considered — every specialist shift
/// then reported "24 eligible, all already assigned to something else that day". The
/// bulk pass sits last for the same reason: `AMER:Crew` sorts before `AMER:Crew-BC` and
/// `AMER:Lead`, so mixing it into pass 3 would repeat that mistake one floor down.
///
/// Passes stay separate because they answer different questions: "everyone works today,
/// and this is where they work" is the day configuration; "who covers a specialist or
/// weekend shift" is fairness and recency.
///
/// Passes 2 and 3 skip weekend and holiday configurations: those are duty rosters, and
/// filling them to capacity would invent weekend work — and the comp days that come with
/// it (ADR-0007). A weekend gets exactly its minimums.
///
/// Every pass respects <see cref="ShiftRequirement.Max"/>. A null Max means unlimited,
/// which is not a fill target — pass 3 skips such a requirement, and only pass 4 claims
/// it, and only when it is the day's declared default.
///
/// Never touches an already-occupied or locked cell. Deterministic: dates ascending,
/// people by stable id — the same input gives the same output, or rerunning after one
/// edit would reshuffle the whole month.
///
/// Unlike the TypeScript original, this returns the proposed <see cref="Assignment"/>
/// and <see cref="CompDayEntry"/> rows directly rather than generic DraftChange
/// records — draft/publish persistence is a separate concern the caller (the eventual
/// /api/auto-populate endpoint) owns.
/// </summary>
public static class AutoPopulateService
{
    public const int MaxDays = 92;

    public record Gap(DateOnly Date, string ShiftId, string Code, string Reason);

    public record Result(
        IReadOnlyList<Assignment> Assignments, IReadOnlyList<CompDayEntry> CompDays, IReadOnlyList<Gap> Gaps)
    {
        public int AssignedCount => Assignments.Count;
    }

    public record Params(
        string UnitId, DateOnly RangeFrom, DateOnly RangeTo,
        /// <summary>Cells the planner pinned by hand — generation doesn't see them.</summary>
        IReadOnlySet<string> LockedAssignmentIds,
        IReadOnlyList<Assignment> Assignments, IReadOnlyList<Absence> Absences, IReadOnlyList<CompDayEntry> CompDays,
        DatasetIndex Index, string ActorId, DateTimeOffset Now);

    public static Result Run(Params p)
    {
        var dates = DateHelpers.EachDate(p.RangeFrom, p.RangeTo).ToList();
        var locked = p.Assignments.Where(a => p.LockedAssignmentIds.Contains(a.Id)).Select(CellKey).ToHashSet();

        // Рабочая копия назначений: растёт по ходу прогона, чтобы справедливость и
        // давность на пятницу уже видели то, что сгенерировано в понедельник.
        var working = new List<Assignment>(p.Assignments);
        var occupied = working.Select(CellKey).ToHashSet();

        var generated = new List<Assignment>();
        var gaps = new List<Gap>();

        void Place(string personId, DateOnly date, string shiftId)
        {
            var person = p.Index.People.GetValueOrDefault(personId);
            var location = person is not null ? p.Index.Locations.GetValueOrDefault(person.LocationId) : null;
            var assignment = new Assignment
            {
                Id = $"as-gen-{date:yyyy-MM-dd}-{personId}",
                PersonId = personId,
                Date = date,
                UnitId = p.UnitId,
                ContentKind = AssignmentContentKind.Shift,
                ShiftId = shiftId,
                IsWeekend = location is not null && location.WeekendDays.Contains(DateHelpers.IsoWeekdayOf(date)),
                Source = AssignmentSource.Generated,
                Version = 0,
                CreatedBy = p.ActorId,
                CreatedAt = p.Now,
                UpdatedBy = p.ActorId,
                UpdatedAt = p.Now,
            };
            working.Add(assignment);
            occupied.Add(CellKey(assignment));
            generated.Add(assignment);
        }

        var peopleInUnit = (p.Index.PeopleByUnit.TryGetValue(p.UnitId, out var list) ? list : [])
            .Where(person => person.IsIncluded)
            .OrderBy(person => person.Id, StringComparer.Ordinal)
            .ToList();

        int FilledOn(DateOnly date, string shiftId) => working.Count(a =>
            a.Date == date && a.ContentKind == AssignmentContentKind.Shift && a.ShiftId == shiftId);

        /// <summary>Ranked fill of one requirement up to <paramref name="target"/>.
        /// Returns the reason it could not get there, for the caller to record as a gap
        /// or ignore — that judgement belongs to the pass, not here.</summary>
        string? FillTowards(DateOnly date, ShiftRequirement requirement, int target)
        {
            var filled = FilledOn(date, requirement.ShiftId);
            while (filled < target)
            {
                var busyToday = working.Where(a => a.Date == date).Select(a => a.PersonId).ToHashSet();
                var result = CandidateRanker.Rank(new CandidateRanker.RankParams(
                    requirement.ShiftId, date, p.UnitId, p.Index, working, p.Absences, p.CompDays, busyToday));

                var pick = result.Available.FirstOrDefault();
                if (pick is null) return GapReason(result);

                Place(pick.PersonId, date, requirement.ShiftId);
                filled++;
            }
            return null;
        }

        // Выходные и праздники — дежурство, а не рабочий день: их закрывают только
        // минимумы. Дефолты и догрузка туда не идут, иначе генерация сама придумает
        // работу в выходной и отгулы за неё.
        static bool IsDutyRoster(DayConfiguration config) =>
            config.Key is DayConfigKey.Weekend or DayConfigKey.Holiday;

        // --- 1. Минимумы ------------------------------------------------------------

        foreach (var date in dates)
        {
            var config = DayConfigurationResolver.Resolve(p.UnitId, date, p.Index);
            if (config is null) continue;

            foreach (var requirement in config.ShiftRequirements.OrderBy(r => r.ShiftId, StringComparer.Ordinal))
            {
                var reason = FillTowards(date, requirement, requirement.Min);
                if (reason is not null)
                {
                    gaps.Add(new Gap(date, requirement.ShiftId, ShiftCode(p.Index, requirement.ShiftId), reason));
                }
            }
        }

        // --- 2. Дефолты -------------------------------------------------------------

        foreach (var date in dates)
        {
            var weekday = DateHelpers.IsoWeekdayOf(date);
            var config = DayConfigurationResolver.Resolve(p.UnitId, date, p.Index);
            if (config is null || IsDutyRoster(config)) continue;

            foreach (var person in peopleInUnit)
            {
                var key = $"{person.Id}|{date:yyyy-MM-dd}";
                if (occupied.Contains(key) || locked.Contains(key)) continue;
                if (person.DefaultShiftId is null) continue;
                if (!person.Eligibility.Any(e => e.ShiftId == person.DefaultShiftId)) continue;

                var requirement = config.ShiftRequirements.FirstOrDefault(r => r.ShiftId == person.DefaultShiftId);
                if (requirement is null) continue; // сегодня эта смена не выставляется
                // Потолок держит и дефолт: если чей-то дефолт — Lead с max=1, вторым его
                // никто не получает.
                if (requirement.Max is int max && FilledOn(date, requirement.ShiftId) >= max) continue;

                var blocked = CandidateRanker.AvailabilityBlockReason(person, date, weekday, p.Absences, p.CompDays);
                if (blocked is not null) continue;

                Place(person.Id, date, person.DefaultShiftId);
            }
        }

        // --- 3. Догрузка до потолка на обычных рабочих днях --------------------------

        foreach (var date in dates)
        {
            var config = DayConfigurationResolver.Resolve(p.UnitId, date, p.Index);
            if (config is null || IsDutyRoster(config)) continue;

            foreach (var requirement in config.ShiftRequirements.OrderBy(r => r.ShiftId, StringComparer.Ordinal))
            {
                // Null Max — «сколько угодно»: цель заполнения из этого не следует,
                // такую смену разбирает проход 4.
                if (requirement.Max is not int max) continue;
                // Недобор выше минимума — не дыра: свободная ёмкость, а не невыполненное
                // обязательство. Причину сюда возвращает FillTowards, и мы её отбрасываем.
                _ = FillTowards(date, requirement, max);
            }
        }

        // --- 4. Массовая смена дня ---------------------------------------------------
        //
        // Идёт последней, и это не деталь: `AMER:Crew` в алфавите стоит перед
        // `AMER:Crew-BC` и `AMER:Lead`, так что смешай её с потолочными — и она забрала
        // бы людей раньше, чем до тех дошла очередь. Та же ошибка, из-за которой дефолты
        // когда-то съедали команду до минимумов, только этажом ниже.

        foreach (var date in dates)
        {
            var config = DayConfigurationResolver.Resolve(p.UnitId, date, p.Index);
            if (config is null || IsDutyRoster(config)) continue;

            foreach (var requirement in config.ShiftRequirements
                .Where(r => r.Max is null && r.IsDefault)
                .OrderBy(r => r.ShiftId, StringComparer.Ordinal))
            {
                // Ни минимума, ни потолка — «сюда идут все остальные». Заполняется, пока
                // есть свободные и подходящие: int.MaxValue здесь не число, а «до конца».
                _ = FillTowards(date, requirement, int.MaxValue);
            }
        }

        // --- Отгулы за только что созданные выходные/праздничные смены -------------

        var generatedIds = generated.Select(a => a.Id).ToHashSet();
        var compResult = CompDayService.Propose(new CompDayService.ProposeParams(
            p.RangeFrom, p.RangeTo, working, p.Absences, p.CompDays, p.Index, generatedIds));

        return new Result(generated, compResult.Added, gaps);
    }

    private static string CellKey(Assignment a) => $"{a.PersonId}|{a.Date:yyyy-MM-dd}";

    private static string ShiftCode(DatasetIndex index, string shiftId) => index.Shifts.GetValueOrDefault(shiftId)?.Code ?? shiftId;

    /// <summary>"3 eligible, all on leave" — not a silent gap (Docs/06).</summary>
    private static string GapReason(CandidateRanker.CandidateResult result)
    {
        if (result.Excluded.Count == 0) return "No one in this region is eligible for this shift";
        var counts = result.Excluded.GroupBy(e => e.Reason).Select(g => $"{g.Count()} {g.Key}");
        return $"{result.Excluded.Count} eligible, {string.Join(", ", counts)}";
    }
}
