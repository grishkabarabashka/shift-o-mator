using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/compDays.test.ts.</summary>
public class CompDayServiceTests
{
    private static readonly DateOnly AugustFrom = new(2026, 8, 1);
    private static readonly DateOnly AugustTo = new(2026, 8, 31);

    private static readonly List<Holiday> Holidays =
    [
        new() { Id = "hol-us-test", Date = new DateOnly(2026, 8, 20), Name = "US test holiday", LocationIds = ["loc-ny"], IsFullDay = true },
        new() { Id = "hol-in-test", Date = new DateOnly(2026, 8, 19), Name = "IN test holiday", LocationIds = ["loc-pune"], IsFullDay = true },
    ];

    private static readonly Person Person = MakePerson("p-ny");
    private static readonly Person PunePerson = MakePerson("p-pune", locationId: PuneLocation.Id);

    private static DatasetIndex IndexWith(List<Assignment>? assignments = null, List<Absence>? absences = null, List<CompDayEntry>? compDays = null) =>
        BuildIndex(MakeDataset(people: [Person, PunePerson], holidays: Holidays, assignments: assignments, absences: absences, compDays: compDays));

    private static CompDayService.ProposeResult ProposeFor(
        (string PersonId, string Date)[] placements, List<CompDayEntry>? existing = null, List<Absence>? absences = null)
    {
        var assignments = placements.Select(p => MakeAssignment(p.PersonId, LeadRole.Id, DateOnly.Parse(p.Date))).ToList();
        var data = MakeDataset(people: [Person, PunePerson], holidays: Holidays, assignments: assignments, absences: absences, compDays: existing);
        return CompDayService.Propose(new CompDayService.ProposeParams(
            AugustFrom, AugustTo, data.Assignments, data.Absences, existing ?? [], BuildIndex(data)));
    }

    public class Triggering
    {
        private readonly DatasetIndex _index = IndexWith();

        [Fact]
        public void A_working_day_triggers_nothing() =>
            Assert.Null(CompDayService.TriggerFor(new DateOnly(2026, 8, 17), Person.LocationId, _index));

        [Fact]
        public void Distinguishes_Saturday_from_Sunday()
        {
            Assert.Equal(CompDayTrigger.Saturday, CompDayService.TriggerFor(new DateOnly(2026, 8, 15), Person.LocationId, _index));
            Assert.Equal(CompDayTrigger.Sunday, CompDayService.TriggerFor(new DateOnly(2026, 8, 16), Person.LocationId, _index));
        }

        [Fact]
        public void A_holiday_outranks_the_weekday()
        {
            // 20 августа — четверг и праздник в календаре Нью-Йорка.
            Assert.Equal(CompDayTrigger.Holiday, CompDayService.TriggerFor(new DateOnly(2026, 8, 20), Person.LocationId, _index));
        }

        [Fact]
        public void Uses_the_persons_own_location_calendar()
        {
            Assert.Equal(CompDayTrigger.Holiday, CompDayService.TriggerFor(new DateOnly(2026, 8, 19), PunePerson.LocationId, _index));
            Assert.Null(CompDayService.TriggerFor(new DateOnly(2026, 8, 19), Person.LocationId, _index));
            Assert.Null(CompDayService.TriggerFor(new DateOnly(2026, 8, 20), PunePerson.LocationId, _index));
        }
    }

    public class WindowSlotSearch
    {
        [Fact]
        public void A_working_day_earns_nothing() =>
            Assert.Empty(ProposeFor([("p-ny", "2026-08-17")]).Added);

        [Fact]
        public void Saturday_gives_the_Thursday_of_the_same_week()
        {
            // Поиск идёт наружу от даты начисления, сначала «после»:
            //   +1 = вс 16-го — нерабочий
            //   −1 = пт 14-го — исключён политикой
            //   +2 = пн 17-го — исключён политикой
            //   −2 = чт 13-го — подходит
            var entry = ProposeFor([("p-ny", "2026-08-15")]).Added[0];
            Assert.Equal(CompDayTrigger.Saturday, entry.Trigger);
            Assert.Equal(new DateOnly(2026, 8, 13), entry.ProposedDate);
            Assert.Equal(CompDayStatus.Proposed, entry.Status);
        }

        [Fact]
        public void Sunday_gives_the_Tuesday_of_next_week()
        {
            // +1 = пн (исключён), −1 = сб (нерабочий), +2 = вт 18-го — подходит.
            var entry = ProposeFor([("p-ny", "2026-08-16")]).Added[0];
            Assert.Equal(CompDayTrigger.Sunday, entry.Trigger);
            Assert.Equal(new DateOnly(2026, 8, 18), entry.ProposedDate);
        }

        [Fact]
        public void Never_lands_on_an_excluded_weekday()
        {
            var entry = ProposeFor([("p-ny", "2026-08-15")]).Added[0];
            var weekday = DateHelpers.IsoWeekdayOf(entry.ProposedDate!.Value);
            Assert.NotEqual(IsoWeekday.Monday, weekday);
            Assert.NotEqual(IsoWeekday.Friday, weekday);
        }

        [Fact]
        public void Steps_around_a_day_occupied_by_another_assignment()
        {
            var result = ProposeFor([("p-ny", "2026-08-15"), ("p-ny", "2026-08-13")]);
            var earned = result.Added.First(e => e.EarnedForDate == new DateOnly(2026, 8, 15));
            Assert.NotEqual(new DateOnly(2026, 8, 13), earned.ProposedDate);
        }

        [Fact]
        public void Steps_around_a_day_blocked_by_leave()
        {
            var vacation = new Absence { Id = "abs-1", PersonId = "p-ny", Type = AbsenceType.Vacation, From = new DateOnly(2026, 8, 11), To = new DateOnly(2026, 8, 14), Source = AbsenceSource.Manual };
            var entry = ProposeFor([("p-ny", "2026-08-15")], absences: [vacation]).Added[0];
            Assert.NotNull(entry.ProposedDate);
            Assert.DoesNotContain(entry.ProposedDate!.Value, new[] { new DateOnly(2026, 8, 11), new DateOnly(2026, 8, 12), new DateOnly(2026, 8, 13), new DateOnly(2026, 8, 14) });
        }

        [Fact]
        public void Two_accruals_never_land_on_the_same_day()
        {
            // Суббота и воскресенье — два независимых события начисления.
            var result = ProposeFor([("p-ny", "2026-08-15"), ("p-ny", "2026-08-16")]);
            Assert.Equal(2, result.Added.Count);
            Assert.Equal(2, result.Added.Select(e => e.ProposedDate).Distinct().Count());
        }

        [Fact]
        public void No_free_day_means_pending_approval_not_silence()
        {
            var wall = new Absence { Id = "abs-wall", PersonId = "p-ny", Type = AbsenceType.Vacation, From = new DateOnly(2026, 7, 25), To = new DateOnly(2026, 9, 5), Source = AbsenceSource.Manual };
            var entry = ProposeFor([("p-ny", "2026-08-15")], absences: [wall]).Added[0];
            Assert.Equal(CompDayStatus.PendingApproval, entry.Status);
            Assert.Null(entry.ProposedDate);
        }
    }

    public class PreservingPlannerDecisions
    {
        [Fact]
        public void Does_not_overwrite_a_moved_comp_day()
        {
            var assignment = MakeAssignment("p-ny", LeadRole.Id, new DateOnly(2026, 8, 15));
            var data = MakeDataset(people: [Person], holidays: Holidays, assignments: [assignment]);
            var moved = new CompDayEntry
            {
                Id = $"cd-{assignment.Id}", PersonId = "p-ny", EarnedForAssignmentId = assignment.Id,
                EarnedForDate = new DateOnly(2026, 8, 15), Trigger = CompDayTrigger.Saturday,
                ProposedDate = new DateOnly(2026, 8, 18), ActualDate = new DateOnly(2026, 8, 27), Status = CompDayStatus.Scheduled,
            };

            var result = CompDayService.Propose(new CompDayService.ProposeParams(
                AugustFrom, AugustTo, data.Assignments, [], [moved], BuildIndex(data)));

            Assert.Empty(result.Added);
            Assert.Single(result.Entries);
            Assert.Equal(new DateOnly(2026, 8, 27), result.Entries[0].ActualDate);
        }

        [Fact]
        public void Flags_entries_whose_assignment_disappeared()
        {
            var orphan = new CompDayEntry
            {
                Id = "cd-gone", PersonId = "p-ny", EarnedForAssignmentId = "as-removed",
                EarnedForDate = new DateOnly(2026, 8, 15), Trigger = CompDayTrigger.Saturday,
                ProposedDate = new DateOnly(2026, 8, 18), Status = CompDayStatus.Scheduled,
            };
            var result = ProposeFor([], existing: [orphan]);
            Assert.Equal(["cd-gone"], result.Orphaned.Select(e => e.Id));
        }

        [Fact]
        public void A_roster_marker_earns_nothing()
        {
            var marker = MakeMarkerAssignment("p-ny", RosterMarker.Off, new DateOnly(2026, 8, 15));
            var data = MakeDataset(people: [Person], holidays: Holidays, assignments: [marker]);
            var result = CompDayService.Propose(new CompDayService.ProposeParams(
                AugustFrom, AugustTo, data.Assignments, [], [], BuildIndex(data)));
            Assert.Empty(result.Added);
        }
    }

    public class AgeAndBalance
    {
        private static readonly List<CompDayEntry> Entries =
        [
            new() { Id = "a", PersonId = "p-ny", EarnedForAssignmentId = "as-1", EarnedForDate = new DateOnly(2026, 6, 6), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 6, 9), Status = CompDayStatus.Proposed },
            new() { Id = "b", PersonId = "p-ny", EarnedForAssignmentId = "as-2", EarnedForDate = new DateOnly(2026, 8, 8), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 8, 11), Status = CompDayStatus.Scheduled },
            new() { Id = "c", PersonId = "p-ny", EarnedForAssignmentId = "as-3", EarnedForDate = new DateOnly(2026, 5, 2), Trigger = CompDayTrigger.Saturday, ActualDate = new DateOnly(2026, 5, 5), Status = CompDayStatus.Taken },
            new() { Id = "d", PersonId = "p-other", EarnedForAssignmentId = "as-4", EarnedForDate = new DateOnly(2026, 7, 11), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 7, 14), Status = CompDayStatus.Proposed },
        ];

        [Fact]
        public void Age_counts_from_the_earned_date() =>
            Assert.Equal(71, CompDayService.Age(Entries[0], new DateOnly(2026, 8, 16)));

        [Fact]
        public void Taken_does_not_age() =>
            Assert.False(CompDayService.IsAged(Entries[2], new DateOnly(2026, 8, 16), 14));

        [Fact]
        public void Hanging_past_the_threshold_is_flagged()
        {
            Assert.True(CompDayService.IsAged(Entries[0], new DateOnly(2026, 8, 16), 14));
            Assert.False(CompDayService.IsAged(Entries[1], new DateOnly(2026, 8, 16), 14));
        }

        [Fact]
        public void Balance_counts_only_the_named_person()
        {
            var balance = CompDayService.Balance("p-ny", Entries, new DateOnly(2026, 8, 16), TestCompOffPolicy.AgingThresholdDays);
            Assert.Equal(3, balance.Earned);
            Assert.Equal(1, balance.Proposed);
            Assert.Equal(1, balance.Scheduled);
            Assert.Equal(1, balance.Taken);
            Assert.Equal(2, balance.Due);
            Assert.Equal(1, balance.Aged);
        }

        [Fact]
        public void The_region_policy_sets_the_threshold() =>
            Assert.Equal(14, TestUnit.CompOffPolicy.AgingThresholdDays);
    }
}
