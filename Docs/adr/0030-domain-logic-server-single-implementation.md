# ADR-0030. Domain logic lives on the server as the single implementation

**Status:** accepted — implements Phase 3; supersedes client-side engines

## Context

The MVP engines (coverage, validation, candidate ranking, auto-populate) were built in
TypeScript and executed on the client for instant feedback. When Phase 2 built a .NET
backend, those engines were ported to C#. The result was two implementations of the
same logic, each needing maintenance and careful synchronization.

A "parity test" proved they produced identical results, but only because they were
near-identical copies. The test was valuable evidence but also a sign of fragility:
keeping them in sync forever was unsustainable, and any divergence (in business rules,
edge cases, new features) would have to be made twice.

Server-side persistence (ADR-0029) made the decision clearer: where does the
authoritative coverage live? If it's the database, then coverage and validation must
compute against what is actually stored, not a projection the client maintains locally.

## Decision

**Domain logic — coverage, validation, candidate ranking, comp-day accrual, absence
limits, auto-populate — is implemented once, on the server, in C#.**

- `ShiftOMator.Application` contains the engines: `CoverageCalculator`, `Validator`,
  `CandidateRanker`, `CompDayService`, `AutoPopulateService`, plus helpers.
- These run synchronously on the backend for every publish, every preview request
  (`GET /api/schedule` with optional `draftId`), and every auto-populate.
- The frontend never computes coverage or validation. It sends a draft for preview via
  the `draftId` query parameter; the server overlays it and returns the recomputed
  snapshot and issues.
- TypeScript on the frontend contains only utilities: date math, timezone conversions,
  grid layout, timeline rendering, cell display projection. Not domain logic.
- Every rule change (a new validation check, a coverage threshold) is implemented once.
- Fairness computation (the CandidateRanker) is deterministic, history-aware, and
  non-portable to the browser (it needs the full audit log, sequential fair shares, and
  historical context). It lives on the backend.

## Consequences

- The frontend is stateless with respect to domain logic. It is a view layer and an
  edit driver.
- Rules and edge cases are single-sourced. A business rule change is one commit, not
  two.
- Coverage and validation results are authoritative and consistent — they cannot drift
  between screen and database.
- The frontend's validation display (the issue list) is purely based on the server's
  response; no shadow computation.
- Client-side coverage computation for pure data exploration (e.g., "what if I put this
  person here?") is impossible without a server round-trip. The UX trades instant
  feedback for consistency — acceptable because publish happens infrequently.
- The Suggest and auto-populate endpoints can be rate-limited and cached server-side
  without complex distributed reasoning.

## Alternatives considered

- **Dual implementation with strict synchronization.** Sustainable only with very large
  engineering effort; parity testing is evidence of fragility, not robustness.
- **Client-side fallback for disconnection.** Using the last-known server state and
  replaying locally is possible but duplicates the engines. ADR-0029 defers offline
  support.
