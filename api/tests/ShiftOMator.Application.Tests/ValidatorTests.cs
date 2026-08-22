using ShiftOMator.Domain;
using static ShiftOMator.Application.Tests.TestFixtures;

namespace ShiftOMator.Application.Tests;

/// <summary>Port of engine/validate.test.ts.</summary>
public class ValidatorTests
{
    private static readonly DateOnly RangeFrom = new(2026, 9, 7);
    private static readonly DateOnly RangeTo = new(2026, 9, 13);

    private static readonly DayConfiguration Weekday = MakeDayConfig(
        "dc-weekday", DayConfigKey.Weekday,
        weekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday],
        roleRequirements:
        [
            new RoleRequirement { DayConfigurationId = "", RoleId = LeadRole.Id, Min = 1, Max = 2, IsDefault = true },
            new RoleRequirement { DayConfigurationId = "", RoleId = NightRole.Id, Min = 0, Max = 1, IsDefault = true },
        ]);

    // Пять будних дней подряд, чтобы минимум был закрыт и не мешал.
    private static readonly List<DateOnly> FilledWeek =
        [.. Enumerable.Range(7, 5).Select(d => new DateOnly(2026, 9, d))];

    private class Scenario
    {
        public List<Person>? People;
        public List<Assignment>? Assignments;
        public List<Absence>? Absences;
        public List<CompDayEntry>? CompDays;
        public List<AbsenceCapacityRule>? AbsenceCapacityRules;
        public DateOnly? AsOf;
    }

    private static List<Issue> IssuesFor(Scenario s)
    {
        var data = MakeDataset(
            people: s.People, assignments: s.Assignments, absences: s.Absences, compDays: s.CompDays,
            dayConfigurations: [Weekday]);
        var index = BuildIndex(data);
        var coverageCells = CoverageCalculator.Compute(TestRegion.Id, RangeFrom, RangeTo, data.Assignments, index);
        return Validator.Validate(new Validator.ValidateParams(
            TestRegion.Id, RangeFrom, RangeTo, data.Assignments, data.Absences, data.CompDays,
            coverageCells, s.AbsenceCapacityRules ?? [], index, s.AsOf ?? new DateOnly(2026, 9, 7)));
    }

    private static List<IssueCode> Codes(IEnumerable<Issue> issues) => issues.Select(i => i.Code).ToList();
    private static Issue? FirstOf(IEnumerable<Issue> issues, IssueCode code) => issues.FirstOrDefault(i => i.Code == code);

    public class BlockingGaps
    {
        [Fact]
        public void Unfilled_coverage_minimum()
        {
            var issues = IssuesFor(new Scenario());
            var issue = FirstOf(issues, IssueCode.CoverageGap);
            Assert.Equal(IssueLevel.Blocking, issue?.Level);
            Assert.Equal(IssueCategory.Gap, issue?.Category);
            Assert.False(Validator.CanPublish(issues, new HashSet<string>()));
        }
    }

    /// <summary>Конфликты не блокируют публикацию (ADR-0024) — требуют подтверждения.
    /// Блокирующими остались только записи, невозможные ни при каком решении.</summary>
    public class AcknowledgeableConflicts
    {
        [Fact]
        public void Assignment_during_vacation()
        {
            var absence = new Absence { Id = "abs-1", PersonId = "p-1", Type = AbsenceType.Vacation, From = new DateOnly(2026, 9, 7), To = new DateOnly(2026, 9, 11), Source = AbsenceSource.Manual };
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9))], Absences = [absence] });
            var issue = FirstOf(issues, IssueCode.AssignedDuringAbsence);
            Assert.Equal(IssueLevel.Warning, issue?.Level);
            Assert.Equal(IssueCategory.Conflict, issue?.Category);
            Assert.Equal(new DateOnly(2026, 9, 9), issue?.Date);

            Assert.False(Validator.CanPublish(issues, new HashSet<string>()));
            Assert.True(Validator.CanPublish([issue!], new HashSet<string> { issue!.Key }));
        }

        [Fact]
        public void Assignment_on_a_confirmed_comp_day()
        {
            var compDay = new CompDayEntry { Id = "cd-1", PersonId = "p-1", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 9, 5), Trigger = CompDayTrigger.Saturday, ActualDate = new DateOnly(2026, 9, 9), Status = CompDayStatus.Scheduled };
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9))], CompDays = [compDay] });
            Assert.Contains(IssueCode.AssignedDuringCompDay, Codes(issues));
        }

        [Fact]
        public void A_proposed_comp_day_does_not_yet_block_an_assignment()
        {
            var compDay = new CompDayEntry { Id = "cd-2", PersonId = "p-1", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 9, 5), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 9, 9), Status = CompDayStatus.Proposed };
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9))], CompDays = [compDay] });
            Assert.DoesNotContain(IssueCode.AssignedDuringCompDay, Codes(issues));
        }

        [Fact]
        public void A_role_outside_the_persons_eligibility()
        {
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 9))] });
            var issue = FirstOf(issues, IssueCode.RoleNotEligible);
            Assert.Equal(IssueLevel.Warning, issue?.Level);
            Assert.Equal(IssueCategory.Conflict, issue?.Category);
        }

        [Fact]
        public void Two_assignments_the_same_day_stay_blocking_ids_differ()
        {
            // Это не решение планировщика, а невозможная запись: ровно одно
            // назначение на (человек, дата) — жёсткое ограничение модели.
            var person = MakePerson("p-1", eligibility:
            [
                new RoleEligibility { PersonId = "", RoleId = LeadRole.Id, TargetShare = 0.5 },
                new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 0.5 },
            ]);
            var second = MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 9), id: "as-dup");
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9)), second] });
            Assert.Equal(IssueLevel.Blocking, FirstOf(issues, IssueCode.DoubleAssignment)?.Level);
        }

        [Fact]
        public void Two_assignments_the_same_day()
        {
            var person = MakePerson("p-1", eligibility:
            [
                new RoleEligibility { PersonId = "", RoleId = LeadRole.Id, TargetShare = 0.5 },
                new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 0.5 },
            ]);
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9)), MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 9))] });
            var issue = FirstOf(issues, IssueCode.DoubleAssignment);
            Assert.Equal(IssueLevel.Blocking, issue?.Level);
            Assert.Equal(IssueCategory.Conflict, issue?.Category);
        }
    }

    public class Warnings
    {
        [Fact]
        public void Over_the_maximum()
        {
            var people = new List<Person> { MakePerson("p-1"), MakePerson("p-2"), MakePerson("p-3") };
            var issues = IssuesFor(new Scenario { People = people, Assignments = [.. people.Select(p => MakeAssignment(p.Id, LeadRole.Id, new DateOnly(2026, 9, 9)))] });
            Assert.Equal(IssueLevel.Warning, FirstOf(issues, IssueCode.CoverageOverMax)?.Level);
        }

        [Fact]
        public void Insufficient_rest_between_a_night_and_a_day_shift()
        {
            var person = MakePerson("p-1", eligibility:
            [
                new RoleEligibility { PersonId = "", RoleId = LeadRole.Id, TargetShare = 0.5 },
                new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 0.5 },
            ]);
            var issues = IssuesFor(new Scenario
            {
                People = [person],
                Assignments = [MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 8)), MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 9))],
            });
            var issue = FirstOf(issues, IssueCode.MinRestViolated);
            Assert.Equal(IssueLevel.Warning, issue?.Level);
            Assert.Equal(new DateOnly(2026, 9, 9), issue?.Date);
        }

        [Fact]
        public void Too_many_consecutive_days()
        {
            var person = MakePerson("p-1", constraints: new PersonConstraints { MinRestHours = 8, MaxConsecutiveDays = 3 });
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [.. FilledWeek.Take(4).Select(d => MakeAssignment("p-1", LeadRole.Id, d))] });
            var issue = FirstOf(issues, IssueCode.ConsecutiveDaysExceeded);
            Assert.Equal(IssueLevel.Warning, issue?.Level);
            Assert.Contains("4 consecutive days", issue?.Message);
        }

        [Fact]
        public void A_weekday_outside_availability()
        {
            var person = MakePerson("p-1", availableWeekdays: [IsoWeekday.Monday, IsoWeekday.Tuesday, IsoWeekday.Wednesday, IsoWeekday.Thursday, IsoWeekday.Friday]);
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 12))] });
            Assert.Contains(IssueCode.UnavailableWeekday, Codes(issues));
        }

        [Fact]
        public void A_role_outside_this_days_configuration()
        {
            // Выходных в конфигурации нет вовсе — суббота роли не предполагает.
            var person = MakePerson("p-1");
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 12))] });
            Assert.Contains(IssueCode.RoleNotInDayConfig, Codes(issues));
        }

        [Fact]
        public void A_comp_day_with_no_free_date_needs_a_decision()
        {
            var pending = new CompDayEntry { Id = "cd-p", PersonId = "p-1", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 9, 5), Trigger = CompDayTrigger.Saturday, Status = CompDayStatus.PendingApproval };
            var issue = FirstOf(IssuesFor(new Scenario { CompDays = [pending] }), IssueCode.CompDayPendingApproval);
            Assert.Equal(IssueLevel.Warning, issue?.Level);
        }

        [Fact]
        public void A_role_pool_limit_catches_what_the_region_counter_misses()
        {
            // Четверо в регионе, двое умеют Lead. Оба в длинном отпуске: по региону
            // лимит 3 не превышен, по пулу Lead — превышен. ADR-0010.
            var people = new List<Person>
            {
                MakePerson("p-lead-1"),
                MakePerson("p-lead-2"),
                MakePerson("p-other-1", eligibility: [new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 1 }]),
                MakePerson("p-other-2", eligibility: [new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 1 }]),
            };
            Absence LongLeave(string personId, string id) => new()
            {
                Id = id, PersonId = personId, Type = AbsenceType.Vacation,
                From = new DateOnly(2026, 9, 7), To = new DateOnly(2026, 9, 18), Source = AbsenceSource.Manual,
            };

            var rules = new List<AbsenceCapacityRule>
            {
                new() { Id = "acr-region", RegionId = TestRegion.Id, ScopeKind = AbsenceCapacityScopeKind.Region, DurationBucket = AbsenceDurationBucket.Long, LongThresholdWorkdays = 5, MaxConcurrent = 3, CountsTypes = [AbsenceType.Vacation, AbsenceType.Sick, AbsenceType.Other], CountsCompDays = true },
                new() { Id = "acr-pool", RegionId = TestRegion.Id, ScopeKind = AbsenceCapacityScopeKind.RolePool, ScopeRoleId = LeadRole.Id, DurationBucket = AbsenceDurationBucket.Long, LongThresholdWorkdays = 5, MaxConcurrent = 1, CountsTypes = [AbsenceType.Vacation, AbsenceType.Sick, AbsenceType.Other], CountsCompDays = true },
            };

            var issues = IssuesFor(new Scenario { People = people, Absences = [LongLeave("p-lead-1", "abs-1"), LongLeave("p-lead-2", "abs-2")], AbsenceCapacityRules = rules });

            var capacity = issues.Where(i => i.Code == IssueCode.AbsenceCapacityExceeded).ToList();
            Assert.NotEmpty(capacity);
            Assert.All(capacity, i => Assert.Equal(LeadRole.Id, i.RoleId));
        }

        [Fact]
        public void A_short_absence_does_not_count_toward_the_long_limit()
        {
            var rules = new List<AbsenceCapacityRule>
            {
                new() { Id = "acr-pool", RegionId = TestRegion.Id, ScopeKind = AbsenceCapacityScopeKind.RolePool, ScopeRoleId = LeadRole.Id, DurationBucket = AbsenceDurationBucket.Long, LongThresholdWorkdays = 5, MaxConcurrent = 1, CountsTypes = [AbsenceType.Vacation], CountsCompDays = false },
            };
            Absence ShortLeave(string personId, string id) => new() { Id = id, PersonId = personId, Type = AbsenceType.Vacation, From = new DateOnly(2026, 9, 8), To = new DateOnly(2026, 9, 9), Source = AbsenceSource.Manual };
            var issues = IssuesFor(new Scenario { People = [MakePerson("p-1"), MakePerson("p-2")], Absences = [ShortLeave("p-1", "abs-1"), ShortLeave("p-2", "abs-2")], AbsenceCapacityRules = rules });
            Assert.DoesNotContain(IssueCode.AbsenceCapacityExceeded, Codes(issues));
        }
    }

    public class Info
    {
        [Fact]
        public void Thin_coverage_is_a_signal_not_a_blocker()
        {
            // Работа ровно по минимуму — норма этого ростера, а не отклонение.
            var issues = IssuesFor(new Scenario { Assignments = [.. FilledWeek.Select(d => MakeAssignment("p-1", LeadRole.Id, d))] });
            var issue = FirstOf(issues, IssueCode.CoverageThin);
            Assert.Equal(IssueLevel.Info, issue?.Level);
            Assert.DoesNotContain(IssueCode.CoverageGap, Codes(issues));
            Assert.True(Validator.CanPublish(issues, new HashSet<string>()));
        }

        [Fact]
        public void Deviation_from_a_target_role_share()
        {
            var person = MakePerson("p-1", eligibility:
            [
                new RoleEligibility { PersonId = "", RoleId = LeadRole.Id, TargetShare = 0.3 },
                new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 0.7 },
            ]);
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [.. FilledWeek.Select(d => MakeAssignment("p-1", LeadRole.Id, d))] });
            var deviations = issues.Where(i => i.Code == IssueCode.TargetShareDeviation).ToList();
            Assert.All(deviations, i => { Assert.Equal(IssueLevel.Info, i.Level); Assert.Equal(IssueCategory.Fairness, i.Category); });
            Assert.Contains("actual 100% vs target 30%", deviations.First(i => i.RoleId == LeadRole.Id).Message);
        }

        [Fact]
        public void Too_few_shifts_skips_the_share_check()
        {
            var person = MakePerson("p-1", eligibility:
            [
                new RoleEligibility { PersonId = "", RoleId = LeadRole.Id, TargetShare = 0.3 },
                new RoleEligibility { PersonId = "", RoleId = NightRole.Id, TargetShare = 0.7 },
            ]);
            var issues = IssuesFor(new Scenario { People = [person], Assignments = [MakeAssignment("p-1", LeadRole.Id, new DateOnly(2026, 9, 7))] });
            Assert.DoesNotContain(IssueCode.TargetShareDeviation, Codes(issues));
        }

        [Fact]
        public void A_comp_day_hanging_past_the_threshold()
        {
            var old = new CompDayEntry { Id = "cd-1", PersonId = "p-1", EarnedForAssignmentId = "as-x", EarnedForDate = new DateOnly(2026, 6, 6), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 6, 9), Status = CompDayStatus.Proposed };
            var issue = FirstOf(IssuesFor(new Scenario { CompDays = [old], AsOf = new DateOnly(2026, 9, 7) }), IssueCode.CompDayAging);
            Assert.Equal(IssueLevel.Info, issue?.Level);
            Assert.Contains("outstanding", issue?.Message);
        }

        [Fact]
        public void A_fresh_comp_day_is_not_highlighted()
        {
            var fresh = new CompDayEntry { Id = "cd-2", PersonId = "p-1", EarnedForAssignmentId = "as-y", EarnedForDate = new DateOnly(2026, 9, 5), Trigger = CompDayTrigger.Saturday, ProposedDate = new DateOnly(2026, 9, 9), Status = CompDayStatus.Proposed };
            Assert.DoesNotContain(IssueCode.CompDayAging, Codes(IssuesFor(new Scenario { CompDays = [fresh], AsOf = new DateOnly(2026, 9, 7) })));
        }

        [Fact]
        public void A_taken_comp_day_does_not_age()
        {
            var taken = new CompDayEntry { Id = "cd-3", PersonId = "p-1", EarnedForAssignmentId = "as-z", EarnedForDate = new DateOnly(2026, 6, 6), Trigger = CompDayTrigger.Saturday, ActualDate = new DateOnly(2026, 6, 9), Status = CompDayStatus.Taken };
            Assert.DoesNotContain(IssueCode.CompDayAging, Codes(IssuesFor(new Scenario { CompDays = [taken], AsOf = new DateOnly(2026, 9, 7) })));
        }
    }

    public class SummaryPublicationAndAcknowledgements
    {
        [Fact]
        public void Sorts_violations_by_level()
        {
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 9))] });
            Assert.Equal(IssueLevel.Blocking, issues[0].Level);
        }

        [Fact]
        public void The_issue_key_is_stable_across_recomputations()
        {
            var scenario = new Scenario();
            Assert.Equal(IssuesFor(scenario).Select(i => i.Key), IssuesFor(scenario).Select(i => i.Key));
        }

        [Fact]
        public void The_summary_separates_gaps_from_conflicts()
        {
            var issues = IssuesFor(new Scenario { Assignments = [MakeAssignment("p-1", NightRole.Id, new DateOnly(2026, 9, 9))] });
            var summary = Validator.Summarize(issues, new HashSet<string>());
            Assert.True(summary.Gaps > 0);
            Assert.True(summary.Conflicts > 0);
            // Конфликт считается по категории независимо от уровня (ADR-0024), и в
            // blocking он больше не входит — там остались только дыры.
            Assert.Equal(summary.Gaps, summary.Blocking);
        }

        [Fact]
        public void Publication_needs_every_warning_acknowledged()
        {
            // Перебор максимума — настоящее предупреждение: три человека на роли
            // с max 2, при этом минимум закрыт и блокеров нет.
            var people = new List<Person> { MakePerson("p-1"), MakePerson("p-2"), MakePerson("p-3") };
            var assignments = new List<Assignment>();
            assignments.AddRange(people.Select(p => MakeAssignment(p.Id, LeadRole.Id, new DateOnly(2026, 9, 9))));
            assignments.AddRange(FilledWeek.Where(d => d != new DateOnly(2026, 9, 9)).Select(d => MakeAssignment("p-1", LeadRole.Id, d)));

            var issues = IssuesFor(new Scenario { People = people, Assignments = assignments });
            Assert.DoesNotContain(issues, i => i.Level == IssueLevel.Blocking);
            Assert.Contains(issues, i => i.Level == IssueLevel.Warning);
            Assert.False(Validator.CanPublish(issues, new HashSet<string>()));

            var acks = Validator.AcknowledgedKeys(issues.Where(i => i.Level == IssueLevel.Warning).Select(i => new Acknowledgement
            {
                IssueKey = i.Key, Comment = "covered by the on-call engineer", ByPersonId = "p-planner", At = DateTimeOffset.Parse("2026-09-07T10:00:00Z"),
            }));
            Assert.True(Validator.CanPublish(issues, acks));
            Assert.Equal(0, Validator.Summarize(issues, acks).UnacknowledgedWarnings);
        }
    }
}
