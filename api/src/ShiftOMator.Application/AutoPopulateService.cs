using ShiftOMator.Domain;

namespace ShiftOMator.Application;

/// <summary>
/// Port of engine/autoPopulate.ts (Docs/06-generation.md). Two passes, not one rule
/// list:
///   A. defaults — the person's DefaultRoleId on their ordinary weekday;
///   B. the rest — whatever defaults didn't cover, filled by ranking
///      (<see cref="CandidateRanker"/>) up to the requirement's minimum.
/// Kept separate because they answer different questions: "whose ordinary job is
/// this" is the person's profile; "who covers a special/weekend role" is fairness and
/// recency. Folding them into one pass would either give defaults a ranking (and
/// "whose job is this" stops being predictable) or give ranked fills a default
/// priority (and specialist roles start going to whoever simply has the lowest count,
/// not whoever it's actually for).
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

    public record Gap(DateOnly Date, string RoleId, string Code, string Reason);

    public record Result(
        IReadOnlyList<Assignment> Assignments, IReadOnlyList<CompDayEntry> CompDays, IReadOnlyList<Gap> Gaps)
    {
        public int AssignedCount => Assignments.Count;
    }

    public record Params(
        string RegionId, DateOnly RangeFrom, DateOnly RangeTo,
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

        void Place(string personId, DateOnly date, string roleId)
        {
            var person = p.Index.People.GetValueOrDefault(personId);
            var location = person is not null ? p.Index.Locations.GetValueOrDefault(person.LocationId) : null;
            var assignment = new Assignment
            {
                Id = $"as-gen-{date:yyyy-MM-dd}-{personId}",
                PersonId = personId,
                Date = date,
                RegionId = p.RegionId,
                ContentKind = AssignmentContentKind.Role,
                RoleId = roleId,
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

        var peopleInRegion = (p.Index.PeopleByRegion.TryGetValue(p.RegionId, out var list) ? list : [])
            .Where(person => person.IsIncluded)
            .OrderBy(person => person.Id, StringComparer.Ordinal)
            .ToList();

        // --- A. Дефолты -----------------------------------------------------------

        foreach (var date in dates)
        {
            var weekday = DateHelpers.IsoWeekdayOf(date);
            var config = DayConfigurationResolver.Resolve(p.RegionId, date, p.Index);
            if (config is null) continue;
            var requiredRoles = config.RoleRequirements.Select(r => r.RoleId).ToHashSet();

            foreach (var person in peopleInRegion)
            {
                var key = $"{person.Id}|{date:yyyy-MM-dd}";
                if (occupied.Contains(key) || locked.Contains(key)) continue;
                if (person.DefaultRoleId is null || !requiredRoles.Contains(person.DefaultRoleId)) continue;
                if (!person.Eligibility.Any(e => e.RoleId == person.DefaultRoleId)) continue;

                var blocked = CandidateRanker.AvailabilityBlockReason(person, date, weekday, p.Absences, p.CompDays);
                if (blocked is not null) continue;

                Place(person.Id, date, person.DefaultRoleId);
            }
        }

        // --- B. Остаток по ранжированию --------------------------------------------

        foreach (var date in dates)
        {
            var config = DayConfigurationResolver.Resolve(p.RegionId, date, p.Index);
            if (config is null) continue;

            var requirements = config.RoleRequirements.OrderBy(r => r.RoleId, StringComparer.Ordinal);

            foreach (var requirement in requirements)
            {
                var filled = working.Count(a => a.Date == date && a.ContentKind == AssignmentContentKind.Role && a.RoleId == requirement.RoleId);

                while (filled < requirement.Min)
                {
                    var busyToday = working.Where(a => a.Date == date).Select(a => a.PersonId).ToHashSet();
                    var result = CandidateRanker.Rank(new CandidateRanker.RankParams(
                        requirement.RoleId, date, p.RegionId, p.Index, working, p.Absences, p.CompDays, busyToday));

                    var pick = result.Available.FirstOrDefault();
                    if (pick is null)
                    {
                        gaps.Add(new Gap(date, requirement.RoleId, RoleCode(p.Index, requirement.RoleId), GapReason(result)));
                        break;
                    }

                    Place(pick.PersonId, date, requirement.RoleId);
                    filled++;
                }
            }
        }

        // --- Отгулы за только что созданные выходные/праздничные смены -------------

        var generatedIds = generated.Select(a => a.Id).ToHashSet();
        var compResult = CompDayService.Propose(new CompDayService.ProposeParams(
            p.RangeFrom, p.RangeTo, working, p.Absences, p.CompDays, p.Index, generatedIds));

        return new Result(generated, compResult.Added, gaps);
    }

    private static string CellKey(Assignment a) => $"{a.PersonId}|{a.Date:yyyy-MM-dd}";

    private static string RoleCode(DatasetIndex index, string roleId) => index.Roles.GetValueOrDefault(roleId)?.Code ?? roleId;

    /// <summary>"3 eligible, all on leave" — not a silent gap (Docs/06).</summary>
    private static string GapReason(CandidateRanker.CandidateResult result)
    {
        if (result.Excluded.Count == 0) return "No one in this region is eligible for this role";
        var counts = result.Excluded.GroupBy(e => e.Reason).Select(g => $"{g.Count()} {g.Key}");
        return $"{result.Excluded.Count} eligible, {string.Join(", ", counts)}";
    }
}
