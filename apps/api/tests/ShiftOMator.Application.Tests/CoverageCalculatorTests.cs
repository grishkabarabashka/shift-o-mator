using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/coverage.test.ts.</summary>
public class CoverageCalculatorTests
{
    private static readonly DayConfiguration Weekday = MakeDayConfig(
        "dc-weekday", DayConfigKey.Weekday,
        weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, Max = 3, IsDefault = true }]);

    private static readonly DayConfiguration Weekend = MakeDayConfig(
        "dc-weekend", DayConfigKey.Weekend,
        weekdays: [IsoWeekday.Saturday, IsoWeekday.Sunday],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, Max = 1, IsDefault = true }]);

    private static readonly DayConfiguration HolidayConfig = MakeDayConfig(
        "dc-holiday", DayConfigKey.Holiday,
        weekdays: [],
        roleRequirements: [new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 2, IsDefault = true }]);

    public class CoverageLevelTests
    {
        [Fact]
        public void Distinguishes_four_states()
        {
            Assert.Equal(CoverageLevel.Gap, CoverageCalculator.Level(0, 1, 3));
            Assert.Equal(CoverageLevel.Thin, CoverageCalculator.Level(1, 1, 3));
            Assert.Equal(CoverageLevel.Ok, CoverageCalculator.Level(2, 1, 3));
            Assert.Equal(CoverageLevel.Over, CoverageCalculator.Level(4, 1, 3));
        }

        [Fact]
        public void Thin_is_exactly_the_minimum_not_a_shade_of_green()
        {
            Assert.Equal(CoverageLevel.Thin, CoverageCalculator.Level(2, 2));
            Assert.Equal(CoverageLevel.Ok, CoverageCalculator.Level(3, 2));
        }

        [Fact]
        public void A_zero_minimum_never_reads_thin()
        {
            // Роль с min 0 всегда «закрыта»; называть это впритык бессмысленно.
            Assert.Equal(CoverageLevel.Ok, CoverageCalculator.Level(0, 0));
        }
    }

    public class ComputeOverAPeriod
    {
        private static readonly List<Person> People = [MakePerson("p-1"), MakePerson("p-2"), MakePerson("p-3")];

        private static List<CoverageCell> CoverageFor(params (string PersonId, string Date)[] placements)
        {
            var assignments = placements
                .Select(p => MakeAssignment(p.PersonId, LeadRole.Id, DateOnly.Parse(p.Date)))
                .ToList();
            var data = MakeDataset(
                people: People,
                assignments: assignments,
                dayConfigurations: [Weekday, Weekend, HolidayConfig],
                holidays: [new Holiday { Id = "hol-labor-day", Date = new DateOnly(2026, 9, 7), Name = "Labor Day", LocationIds = ["loc-ny"], IsFullDay = true }]);
            return CoverageCalculator.Compute(TestUnit.Id, new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 13), data.Assignments, BuildIndex(data));
        }

        [Fact]
        public void One_cell_per_day_with_an_active_requirement()
        {
            Assert.Equal(7, CoverageFor().Count);
        }

        [Fact]
        public void An_empty_day_against_a_minimum_is_a_gap()
        {
            Assert.All(CoverageFor(), c => Assert.Equal(CoverageLevel.Gap, c.Level));
        }

        [Fact]
        public void Counts_actually_assigned()
        {
            var cells = CoverageFor(("p-1", "2026-09-08"), ("p-2", "2026-09-08"));
            var cell = cells.First(c => c.Date == new DateOnly(2026, 9, 8));
            Assert.Equal(2, cell.Actual);
            Assert.Equal(CoverageLevel.Ok, cell.Level);
        }

        [Fact]
        public void One_at_minimum_one_is_thin()
        {
            var cell = CoverageFor(("p-1", "2026-09-08")).First(c => c.Date == new DateOnly(2026, 9, 8));
            Assert.Equal(CoverageLevel.Thin, cell.Level);
        }

        [Fact]
        public void Applies_the_holiday_configuration_on_a_holiday()
        {
            var cell = CoverageFor(("p-1", "2026-09-07")).First(c => c.Date == new DateOnly(2026, 9, 7));
            Assert.Equal(2, cell.Min);
            Assert.Equal(CoverageLevel.Gap, cell.Level);
            Assert.Equal(DayConfigKey.Holiday, cell.AppliedKey);
        }

        [Fact]
        public void Weekends_use_their_own_configuration()
        {
            var cell = CoverageFor(("p-1", "2026-09-12")).First(c => c.Date == new DateOnly(2026, 9, 12));
            Assert.Equal(DayConfigKey.Weekend, cell.AppliedKey);
            Assert.Equal(1, cell.Max);
        }

        [Fact]
        public void Ignores_assignments_outside_the_range()
        {
            Assert.All(CoverageFor(("p-1", "2026-10-01")), c => Assert.Equal(0, c.Actual));
        }

        [Fact]
        public void Roster_markers_do_not_count_toward_coverage()
        {
            var data = MakeDataset(
                people: People,
                assignments: [MakeMarkerAssignment("p-1", RosterMarker.Off, new DateOnly(2026, 9, 8))],
                dayConfigurations: [Weekday, Weekend, HolidayConfig]);
            var cells = CoverageCalculator.Compute(TestUnit.Id, new DateOnly(2026, 9, 8), new DateOnly(2026, 9, 8), data.Assignments, BuildIndex(data));
            Assert.Equal(0, cells[0].Actual);
        }

        [Fact]
        public void A_role_without_CountsAsCoverage_is_not_counted()
        {
            var shadow = new Shift
            {
                Id = "r-shadow",
                UnitId = NightRole.UnitId,
                Code = "Shadow",
                Label = NightRole.Label,
                Color = NightRole.Color,
                TimeZone = NightRole.TimeZone,
                Start = NightRole.Start,
                End = NightRole.End,
                CrossesMidnight = NightRole.CrossesMidnight,
                BreakMinutes = NightRole.BreakMinutes,
                CountsAsCoverage = false,
                EditableTime = NightRole.EditableTime,
            };
            var config = MakeDayConfig(
                "dc-shadow", DayConfigKey.Weekday,
                weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
                roleRequirements:
                [
                    new ShiftRequirement { DayConfigurationId = "", ShiftId = LeadRole.Id, Min = 1, IsDefault = true },
                    new ShiftRequirement { DayConfigurationId = "", ShiftId = shadow.Id, Min = 1, IsDefault = false },
                ]);
            var data = MakeDataset(
                people: People,
                shifts: [LeadRole, shadow],
                dayConfigurations: [config],
                assignments: [MakeAssignment("p-1", shadow.Id, new DateOnly(2026, 9, 8))]);
            var cells = CoverageCalculator.Compute(TestUnit.Id, new DateOnly(2026, 9, 8), new DateOnly(2026, 9, 8), data.Assignments, BuildIndex(data));

            // Клетка для Shadow не создаётся, и назначение никуда не засчитывается.
            Assert.Single(cells);
            Assert.Equal(LeadRole.Id, cells[0].ShiftId);
            Assert.Equal(0, cells[0].Actual);
        }

        [Fact]
        public void Summary_counts_cells_by_level()
        {
            var summary = CoverageCalculator.Summarize(CoverageFor(
                ("p-1", "2026-09-09"), ("p-2", "2026-09-09"), ("p-3", "2026-09-10")));
            Assert.Equal(7, summary.Total);
            Assert.Equal(1, summary.Thin); // 10-е: один при минимуме один
            Assert.Equal(5, summary.Gaps);
        }

        [Fact]
        public void Indexes_cells_by_date_and_role()
        {
            var map = CoverageCalculator.Index(CoverageFor(("p-1", "2026-09-09")));
            Assert.Equal(1, map[(new DateOnly(2026, 9, 9), LeadRole.Id)].Actual);
        }
    }
}
