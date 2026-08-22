using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/autoPopulate.test.ts.</summary>
public class AutoPopulateServiceTests
{
    // 2026-09-07 понедельник; неделя закрывается воскресеньем 2026-09-13.
    private static readonly DateOnly RangeFrom = new(2026, 9, 7);
    private static readonly DateOnly RangeTo = new(2026, 9, 13);

    private static readonly DayConfiguration WeekdayConfig = MakeDayConfig(
        "dc-weekday", DayConfigKey.Weekday,
        weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, IsDefault = true }]);

    private static readonly DayConfiguration WeekendConfig = MakeDayConfig(
        "dc-weekend", DayConfigKey.Weekend,
        weekdays: [IsoWeekday.Saturday, IsoWeekday.Sunday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = NightRole.Id, Min = 1, IsDefault = false }]);

    private static AutoPopulateService.Result Run(
        List<Person>? people = null, List<Assignment>? assignments = null, IReadOnlySet<string>? locked = null)
    {
        var dataset = MakeDataset(dayConfigurations: [WeekdayConfig, WeekendConfig], people: people, assignments: assignments);
        var index = BuildIndex(dataset);
        return AutoPopulateService.Run(new AutoPopulateService.Params(
            TestUnit.Id, RangeFrom, RangeTo, locked ?? new HashSet<string>(),
            dataset.Assignments, dataset.Absences, dataset.CompDays, index, "p-planner",
            DateTimeOffset.Parse("2026-09-01T00:00:00Z")));
    }

    public class Defaults
    {
        [Fact]
        public void Places_DefaultRoleId_on_the_persons_weekdays()
        {
            var alice = MakePerson("p-alice", defaultRoleId: LeadRole.Id, eligibility:
            [
                new ShiftEligibility { PersonId = "", ShiftId = LeadRole.Id, TargetShare = 1 },
                new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 0 },
            ]);
            var result = Run(people: [alice]);

            var weekdayCreates = result.Assignments.Where(a => a.ShiftId == LeadRole.Id).ToList();
            // Пн–Пт этой недели — пять дней.
            Assert.Equal(5, weekdayCreates.Count);
            Assert.All(weekdayCreates, a => Assert.Equal("p-alice", a.PersonId));
        }

        [Fact]
        public void Does_not_touch_an_already_occupied_cell()
        {
            var alice = MakePerson("p-alice", defaultRoleId: LeadRole.Id);
            var existing = MakeAssignment("p-alice", NightRole.Id, new DateOnly(2026, 9, 8)); // вторник, уже занят
            var result = Run(people: [alice], assignments: [existing]);

            Assert.DoesNotContain(result.Assignments, a => a.PersonId == "p-alice" && a.Date == new DateOnly(2026, 9, 8));
        }

        [Fact]
        public void Does_not_touch_a_locked_cell_even_if_empty_in_another_sense()
        {
            // Блокировка снимает роль с рассмотрения целиком — генерация не видит день.
            var alice = MakePerson("p-alice", defaultRoleId: LeadRole.Id);
            var locked = MakeAssignment("p-alice", LeadRole.Id, new DateOnly(2026, 9, 7), id: "as-locked");
            var result = Run(people: [alice], assignments: [locked], locked: new HashSet<string> { "as-locked" });

            Assert.DoesNotContain(result.Assignments, a => a.PersonId == "p-alice" && a.Date == new DateOnly(2026, 9, 7));
        }

        [Fact]
        public void A_mismatched_default_is_not_used_in_pass_A()
        {
            // Дефолт — ночная роль, а будняя группа требует дневную: дефолт не
            // подходит дню, и остаток (проход B) закрыть некем — eligibility нет.
            var bob = MakePerson("p-bob", defaultRoleId: NightRole.Id,
                eligibility: [new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 }]);
            var result = Run(people: [bob]);

            Assert.DoesNotContain(result.Assignments, a => a.ShiftId == LeadRole.Id);
            Assert.Contains(result.Gaps, g => g.ShiftId == LeadRole.Id);
        }
    }

    public class RankedFill
    {
        [Fact]
        public void Fills_a_weekend_role_with_no_default_via_candidates()
        {
            var alice = MakePerson("p-alice", eligibility: [new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 }]);
            var result = Run(people: [alice]);

            // Сб 12, Вс 13 — единственные выходные дни диапазона.
            var weekendCreates = result.Assignments.Where(a => a.Date == new DateOnly(2026, 9, 12) || a.Date == new DateOnly(2026, 9, 13)).ToList();
            Assert.Equal(2, weekendCreates.Count);
            Assert.All(weekendCreates, a => Assert.Equal("p-alice", a.PersonId));
        }

        [Fact]
        public void Leaves_a_gap_with_a_reason_when_no_one_can_close_it()
        {
            var alice = MakePerson("p-alice",
                eligibility: [new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 }],
                availableWeekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday]); // выходные вне доступности
            var result = Run(people: [alice]);

            var gap = result.Gaps.FirstOrDefault(g => g.ShiftId == NightRole.Id);
            Assert.NotNull(gap);
            Assert.Contains("not available this weekday", gap!.Reason);
        }

        [Fact]
        public void Generates_a_comp_day_for_a_just_created_weekend_shift()
        {
            var alice = MakePerson("p-alice", eligibility: [new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 }]);
            var result = Run(people: [alice]);

            Assert.NotEmpty(result.CompDays);
            Assert.Equal("p-alice", result.CompDays[0].PersonId);
        }
    }

    public class Determinism
    {
        [Fact]
        public void The_same_input_gives_the_same_set_of_changes()
        {
            var alice = MakePerson("p-alice", defaultRoleId: LeadRole.Id, eligibility:
            [
                new ShiftEligibility { PersonId = "", ShiftId = LeadRole.Id, TargetShare = 1 },
                new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 },
            ]);
            var bob = MakePerson("p-bob", eligibility: [new ShiftEligibility { PersonId = "", ShiftId = NightRole.Id, TargetShare = 1 }]);

            var a = Run(people: [alice, bob]);
            var b = Run(people: [alice, bob]);

            List<string> Summarize(AutoPopulateService.Result r) =>
            [
                .. r.Assignments.Select(x => $"{x.PersonId}|{x.Date:yyyy-MM-dd}|ASSIGNMENT")
                    .Concat(r.CompDays.Select(x => $"{x.PersonId}|COMP_DAY"))
                    .OrderBy(x => x, StringComparer.Ordinal),
            ];

            Assert.Equal(Summarize(a), Summarize(b));
        }
    }

    [Fact]
    public void The_range_limit_is_documented_as_a_constant() =>
        Assert.Equal(92, AutoPopulateService.MaxDays);
}
