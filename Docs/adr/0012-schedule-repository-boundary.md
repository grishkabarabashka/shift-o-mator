# ADR-0012. `ScheduleRepository` is the single data boundary; every method is async

**Status:** accepted

## Context

The MVP is built outside the corporate perimeter and runs on fixtures. Production is
.NET on AKS with Postgres. There should be no interface rewrite between these two
states.

## Decision

`ScheduleRepository` is the single point of access to data. No component and no
engine function talks to storage directly.

In the MVP it's an in-memory implementation over fixtures with IndexedDB persistence
and JSON import/export. Later, the same signature sits on top of .NET endpoints.

**Every method is async from day one**, even when the data is local.

The generator sits behind the same kind of interface: a simple greedy client-side one
in the MVP (to validate the preview and explanation UX), a solver on the backend
later.

## Consequences

- No hunting later for places where the code implicitly assumed synchronicity — there
  won't be any.
- State loads through TanStack Query, and the editing draft lives separately in
  Zustand. Mixing "data from the server" with "my unsaved edits" is the top source of
  bugs in editors, and this separation is made from the start.
- The engine (`engine/`) takes data as arguments and doesn't know about the
  repository at all.
- Engine tests need no storage mocks.

## Alternatives considered

- **Components accessing storage directly.** Moving to the API turns into a
  wall-to-wall rewrite.
- **Synchronous methods in the MVP.** A guaranteed rewrite once the network shows up.
