using ShiftOMator.Application;

namespace ShiftOMator.Application.Tests;

/// <summary>
/// The deciding factor is the part that must be exactly right (ADR-0052): a planner is
/// about to justify a rota decision with it, and a plausible-but-wrong reason is worse
/// than no reason at all.
/// </summary>
public class CandidateDigestTests
{
    private static CandidateRanker.Candidate Candidate(
        string id, int count90, int? daysSince, int weekendLoad = 0, params string[] warnings) =>
        new(id, id, count90, daysSince, weekendLoad, warnings);

    public class TheDecidingFactor
    {
        [Fact]
        public void Is_the_fairness_count_when_it_differs()
        {
            var factor = CandidateDigest.DecidingFactor(
                Candidate("alice", count90: 1, daysSince: 5),
                Candidate("bob", count90: 4, daysSince: 30));

            Assert.Contains("1 times in 90 days", factor);
            Assert.Contains("4", factor);
        }

        [Fact]
        public void Falls_through_to_recency_when_counts_tie()
        {
            var factor = CandidateDigest.DecidingFactor(
                Candidate("alice", count90: 2, daysSince: 40),
                Candidate("bob", count90: 2, daysSince: 10));

            Assert.Contains("40 days ago", factor);
        }

        [Fact]
        public void Says_never_held_rather_than_quoting_a_sentinel()
        {
            var factor = CandidateDigest.DecidingFactor(
                Candidate("alice", count90: 0, daysSince: null),
                Candidate("bob", count90: 0, daysSince: 10));

            Assert.Contains("never held", factor);
        }

        [Fact]
        public void Falls_through_to_warnings_when_count_and_recency_tie()
        {
            var factor = CandidateDigest.DecidingFactor(
                Candidate("alice", count90: 2, daysSince: 10),
                Candidate("bob", count90: 2, daysSince: 10, weekendLoad: 0, "Third weekend this quarter"));

            Assert.Contains("fewer soft-rule warnings", factor);
        }

        [Fact]
        public void Admits_an_arbitrary_order_instead_of_inventing_a_reason()
        {
            // WHY this case is explicit: everything the ranker measures is equal and the
            // tie-break is the person id. Dressing that up as a reason is precisely the
            // failure the digest exists to prevent.
            var factor = CandidateDigest.DecidingFactor(
                Candidate("alice", count90: 2, daysSince: 10),
                Candidate("bob", count90: 2, daysSince: 10));

            Assert.Contains("arbitrary", factor);
        }

        [Fact]
        public void Says_so_when_there_is_only_one_candidate()
        {
            var factor = CandidateDigest.DecidingFactor(Candidate("alice", 3, 2), runnerUp: null);

            Assert.Contains("only person", factor);
        }
    }

    public class Rendering
    {
        private static CandidateRanker.CandidateResult Result(
            IReadOnlyList<CandidateRanker.Candidate> available,
            IReadOnlyList<CandidateRanker.ExcludedCandidate>? excluded = null) =>
            new(available, excluded ?? [], 1.5);

        [Fact]
        public void Names_the_leader_and_the_reason()
        {
            var digest = CandidateDigest.Render(
                Result([Candidate("Alice", 1, 30), Candidate("Bob", 3, 2)]),
                "Lead", new DateOnly(2026, 9, 7));

            Assert.Contains("Ranked first: Alice", digest);
            Assert.Contains("Lead on 2026-09-07", digest);
        }

        [Fact]
        public void Groups_exclusions_by_reason_rather_than_repeating_it()
        {
            // Four names against one reason is the finding; the same reason spelled out
            // four times is the same finding, four times.
            var digest = CandidateDigest.Render(
                Result(
                    [Candidate("Alice", 1, 30)],
                    [
                        new("bob", "Bob", "On leave"),
                        new("cara", "Cara", "On leave"),
                        new("dan", "Dan", "Not available on Mondays"),
                    ]),
                "Lead", new DateOnly(2026, 9, 7));

            Assert.Contains("On leave: Bob, Cara", digest);
            Assert.Contains("Not available on Mondays: Dan", digest);
        }

        [Fact]
        public void Reports_an_empty_pool_plainly()
        {
            var digest = CandidateDigest.Render(Result([]), "Lead", new DateOnly(2026, 9, 7));

            Assert.Contains("No candidate is both eligible and available", digest);
        }

        [Fact]
        public void Counts_the_tail_instead_of_listing_everyone()
        {
            var many = Enumerable.Range(0, 9)
                .Select(i => Candidate($"p{i}", i, i + 1))
                .ToList();

            var digest = CandidateDigest.Render(Result(many), "Lead", new DateOnly(2026, 9, 7));

            Assert.Contains("(4 more eligible and available)", digest);
        }
    }
}
