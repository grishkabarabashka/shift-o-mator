using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/dayConfig.test.ts.</summary>
public class DayConfigurationResolverTests
{
    private static readonly DayConfiguration MonThu = MakeDayConfig(
        "dc-weekday", DayConfigKey.Weekday,
        weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, Max = 1, IsDefault = true }]);

    private static readonly DayConfiguration Friday = MakeDayConfig(
        "dc-friday", DayConfigKey.Friday,
        weekdays: [IsoWeekday.Friday],
        // У пятницы свой набор ролей, а не другие минимумы того же набора.
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = NightRole.Id, Min = 2, IsDefault = true }]);

    private static readonly DayConfiguration Weekend = MakeDayConfig(
        "dc-weekend", DayConfigKey.Weekend,
        weekdays: [IsoWeekday.Saturday, IsoWeekday.Sunday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, IsDefault = true }]);

    private static readonly DayConfiguration Holiday = MakeDayConfig(
        "dc-holiday", DayConfigKey.Holiday,
        weekdays: [],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = NightRole.Id, Min = 1, IsDefault = true }]);

    private static DatasetIndex IndexWith(List<DayConfiguration> configs, List<string>? holidays = null)
    {
        var holidayEntities = (holidays ?? [])
            .Select(d => new Domain.Holiday { Id = $"hol-{d}", Date = DateOnly.Parse(d), Name = "Test holiday", LocationIds = ["loc-ny"], IsFullDay = true })
            .ToList();
        return BuildIndex(MakeDataset(dayConfigurations: configs, holidays: holidayEntities));
    }

    public class GroupSelection
    {
        private readonly DatasetIndex _index = IndexWith([MonThu, Friday, Weekend, Holiday], ["2026-09-08"]);

        [Fact]
        public void Monday_falls_into_weekday()
        {
            // 2026-09-07 — понедельник.
            Assert.Equal("dc-weekday", DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 7), _index)?.Id);
        }

        [Fact]
        public void Friday_has_its_own_group_with_a_different_role_set()
        {
            // 2026-09-11 — пятница.
            var config = DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 11), _index);
            Assert.Equal("dc-friday", config?.Id);
            Assert.Equal(NightRole.Id, config?.ShiftRequirements[0].ShiftId);
        }

        [Fact]
        public void Weekend_is_separate_from_weekdays()
        {
            Assert.Equal("dc-weekend", DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 12), _index)?.Id);
        }

        [Fact]
        public void Holiday_overrides_a_weekday()
        {
            // 2026-09-08 — вторник и праздник в календаре Нью-Йорка.
            Assert.Equal("dc-holiday", DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 8), _index)?.Id);
        }

        [Fact]
        public void Holiday_status_is_judged_by_the_region_primary_location_not_the_person()
        {
            // Праздник объявлен только для Пуны — для ростера AMER это обычный день.
            var puneOnly = IndexWith([MonThu, Friday, Weekend, Holiday]);
            var withPuneHoliday = BuildIndex(MakeDataset(
                dayConfigurations: [MonThu, Friday, Weekend, Holiday],
                holidays: [new Domain.Holiday { Id = "hol-pune-only", Date = new DateOnly(2026, 9, 8), Name = "Pune only", LocationIds = ["loc-pune"], IsFullDay = true }]));
            Assert.Equal("dc-weekday", DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 8), withPuneHoliday)?.Id);
        }

        [Fact]
        public void No_matching_group_means_no_requirements()
        {
            var weekdaysOnly = IndexWith([MonThu]);
            Assert.Null(DayConfigurationResolver.Resolve(TestUnit.Id, new DateOnly(2026, 9, 12), weekdaysOnly));
        }
    }

    public class EffectiveDatedVersioning
    {
        private static readonly DayConfiguration V1 = MakeDayConfig(
            "dc-v1", DayConfigKey.Weekday,
            weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
            effectiveFrom: new DateOnly(2020, 1, 1),
            roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, IsDefault = true }]);

        private static readonly DayConfiguration V2 = MakeDayConfig(
            "dc-v2", DayConfigKey.Weekday,
            weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
            effectiveFrom: new DateOnly(2026, 9, 1),
            roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 2, IsDefault = true }]);

        private readonly DatasetIndex _index = IndexWith([V1, V2]);

        [Fact]
        public void The_past_uses_the_rule_in_effect_then()
        {
            Assert.Equal(1, DayConfigurationResolver.ResolveRequirement(TestUnit.Id, LeadRole.Id, new DateOnly(2026, 3, 2), _index)?.Min);
        }

        [Fact]
        public void After_the_effective_date_the_new_version_applies()
        {
            Assert.Equal(2, DayConfigurationResolver.ResolveRequirement(TestUnit.Id, LeadRole.Id, new DateOnly(2026, 9, 2), _index)?.Min);
        }

        [Fact]
        public void On_the_effective_date_the_new_version_already_applies()
        {
            Assert.Equal(2, DayConfigurationResolver.ResolveRequirement(TestUnit.Id, LeadRole.Id, new DateOnly(2026, 9, 1), _index)?.Min);
        }

        [Fact]
        public void A_future_version_does_not_affect_today()
        {
            var future = MakeDayConfig(
                "dc-v3", DayConfigKey.Weekday,
                weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
                effectiveFrom: new DateOnly(2027, 1, 1),
                roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 9, IsDefault = true }]);
            var withFuture = IndexWith([V1, V2, future]);
            Assert.Equal(2, DayConfigurationResolver.ResolveRequirement(TestUnit.Id, LeadRole.Id, new DateOnly(2026, 9, 2), withFuture)?.Min);
        }
    }

    public class Integrity
    {
        [Fact]
        public void Catches_a_weekday_claimed_by_two_weekday_groups()
        {
            var overlapping = MakeDayConfig("dc-bad", DayConfigKey.Friday, weekdays: [IsoWeekday.Thursday, IsoWeekday.Friday]);
            var problems = DayConfigurationResolver.FindWeekdayCollisions([MonThu, overlapping]);
            Assert.Single(problems);
            Assert.Contains("weekday 4", problems[0]);
        }

        [Fact]
        public void A_correct_configuration_has_no_problems()
        {
            Assert.Empty(DayConfigurationResolver.FindWeekdayCollisions([MonThu, Friday, Weekend, Holiday]));
        }

        [Fact]
        public void Different_versions_of_the_same_group_are_not_a_conflict()
        {
            var v2 = MakeDayConfig(
                "dc-weekday-v2", DayConfigKey.Weekday,
                weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday],
                effectiveFrom: new DateOnly(2026, 9, 1));
            Assert.Empty(DayConfigurationResolver.FindWeekdayCollisions([MonThu, v2]));
        }
    }
}
