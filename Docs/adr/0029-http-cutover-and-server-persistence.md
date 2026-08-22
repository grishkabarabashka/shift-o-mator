# ADR-0029. HTTP cutover: published and draft data move to the server

**Status:** accepted — implements Phase 5, supersedes in-memory `MemoryScheduleRepository`

## Context

The MVP (Phases 1–2) stored everything in-memory with a fixture layer, persisted to
IndexedDB for offline survival. This works for validation and prototyping but fails at
deployment: every user has a private copy of the state, stale data is invisible, and
concurrent editing requires real merging logic.

Phase 2 built a real backend with EF Core persistence. Phase 3 moved domain logic
(coverage, validation, ranking) to C# as the single source of truth. Now the decision:
where do published assignments and draft sessions live?

The in-memory approach left domain engines stranded on the client side, mirrored in
C# but never trusted. The hidden debt: both implementations had to be kept in sync,
and any inconsistency was invisible until production. Parity testing proved both
implementations matched, but only because they were identical copies.

## Decision

**Drafts and published data are server-side. The frontend is entirely HTTP-driven.**

- `ScheduleRepository` becomes `HttpScheduleRepository`, every method making REST calls.
- Draft sessions persist in the database, not locally. `POST /api/drafts` creates or
  returns an existing session; `POST /api/drafts/{id}/changes` appends changes; `POST
  /api/drafts/{id}/publish` is an atomic transaction.
- Published assignments and absences live in the database. `GET /api/schedule` returns
  the published roster for a range. An optional `draftId` parameter overlays a draft's
  changes on the response for live preview without publishing.
- TanStack Query owns all server state. Zustand holds only draft session metadata
  (the current draft ID, change count) and ephemeral UI state (selection, zoom, filters).
- IndexedDB and offline support are deferred — a real backend makes that a different
  problem and not a requirement of this phase.
- OpenAPI types are generated from the backend schema; the build fails if they drift,
  preventing the kind of silent inconsistency that plagued the mirrored engines.

## Consequences

- The single source of truth is now the database, not competing client/server copies.
- Concurrent editing is real: two planners in the same region and range see a blue
  banner and resolve conflicts at publish time via row versions, not via reservation
  systems.
- Coverage and validation compute server-side with authoritative data. The client
  trusts the server's `remainingGaps` and `issues` in the publish response and
  never recomputes them locally.
- Draft creation and change appending go through the network. This is faster than a
  local DB but slower than in-memory; rate-limiting and optimistic UI update are
  expected and necessary.
- The `with-draft` helper pattern on the frontend wraps mutations: apply the change
  locally for instant UI feedback, then push it to the server, then reconcile if a
  conflict surfaces (a 409 with a row-version mismatch).
- Viewer clients (read-only) never create a draft session and see only published data.

## Alternatives considered

- **Keep everything local, sync periodically.** Violates the single source of truth;
  creates silent inconsistency and merge complexity.
- **Client-side drafts, server-side published data.** Drafts stay in IndexedDB; the
  server stores only published assignments. Leaves the coverage engine stranded in
  JavaScript; half the benefit without the simplicity.
