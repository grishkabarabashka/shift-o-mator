# ADR-0048. AI explains the plan and never decides it

**Status:** accepted

## Context

One AI feature already shipped — `POST /api/insights/gap-summary`, plain-English prose over
a validator digest — and had **no ADR**, no mention in `Docs/12-architecture.md`'s endpoint
table, and no mention in `CLAUDE.md`. It carried an external model dependency, a `503`
degradation path and a carefully constrained prompt, all undocumented.

The question put to the owner was how far to take it. Four levels were laid out:

| Level | What | Risk |
|---|---|---|
| L0 | as-is | — |
| **L1** | explanations: why this candidate, what changed in this draft | bounded by the digest; cost ≈ nil |
| L2 | natural-language queries over the schedule | PII in prompts needs security sign-off |
| L3 | natural-language editing through a draft | safe *only* because the draft is a review gate |
| L4 | copilot: AI conflict resolution, predictive coverage risk | needs months of real data; non-determinism in planning |

Separately, replacing the greedy `AutoPopulateService` with OR-Tools CP-SAT was noted —
classical optimization, not AI, and it trades explainability for optimality.

The owner chose **L1 for now**.

## Decision

**Every AI surface is a digest first and prose second, and the model never writes.**

The invariant, stated once so it can be applied to anything added later:

> A deterministic function computes the answer. The model only phrases it. If the digest
> is wrong the summary is wrong no matter how it is generated — so the digest is what gets
> tested.

This phase adds one surface, `POST /api/insights/candidate-explanation`, built the same
way as the gap summary:

- `Application/CandidateDigest` — pure, tested — renders a `CandidateRanker` result and
  computes the **deciding factor** by reading the ranker's documented ordering: eligibility,
  then availability, then fewest in 90 days, then recency, then warnings, then id. The
  first *differing* criterion between the leader and the runner-up is the honest reason.
- `Insights/CandidateExplanationService` turns that into two or three sentences under a
  prompt that forbids any number, name, date or cause not in the digest.

Two properties follow from the split and are worth naming:

- **The endpoint answers without a model.** `decidingFactor` and `digest` are always
  present; `explanation` is null when nothing is configured or the call failed. A planner
  with no model access still gets the real answer, just not phrased.
- **It refuses to invent a reason.** When every measured criterion ties, the deciding
  factor is literally *"tied with the others on every fairness measure — the order here is
  arbitrary"*, and the prompt is told to say that plainly. A planner is about to justify a
  rota decision with this sentence; a plausible-but-wrong rationale is worse than none.

The suggestion popover shows the computed factor when there is no prose, and the generated
sentence when there is — never silently substituting one for the other.

## Consequences

- The AI surface stays optional in exactly the way it already was: unconfigured is a
  supported state, not an error, and no planning function depends on it.
- The explanation query is **independent of the candidate query** in the UI. The list must
  never wait on prose; a slow or absent model costs nothing.
- L3 is pre-authorised in shape but not in scope: if natural-language editing is built, it
  goes through the existing draft/publish gate, which is the only reason it would be safe.
  Nothing may write to published data on a model's say-so.
- L2 stays blocked on a security decision about PII in prompts, not on engineering.
- CP-SAT remains an open option for auto-populate and is explicitly *not* this ADR's
  subject. Note the trade: it would make generation optimal and simultaneously destroy the
  "why this person" answer this ADR just built.

## Alternatives considered

- **Let the model rank candidates.** It would produce a ranking and a confident
  explanation, and neither would be the fairness policy the team agreed. The ranker exists
  because the ordering is a *decision*, not an inference.
- **Skip the digest, prompt with raw rows.** Cheaper to write, and it moves the correctness
  of counting and grouping into a place that cannot be unit-tested.
- **Go to L4 now.** `Docs/06-generation.md` already says not before two or three months of
  real data, and there is none yet.
