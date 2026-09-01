# Roadmap and Phase History

## Current state: Phases 0–11 complete

The first Frontend-only MVP built roadmap stages 1–14 above an in-memory fixture layer.
Phases 0–6 reworked the entire stack to move domain logic to a real backend and align
the frontend to the specification of an earlier corporate implementation. Phases 7–8 were
the model rework (Region deleted, one absolute-time Shift entity). Phase 9 made the
product production-shaped and absorbed the separate self-service portal. Phase 10 made the
grid one grid for everybody. Phase 11 rebuilt the authorization model and split the write
paths: drafts publish the rota, everything else is written directly and reviewed by
approval.

**Phases completed:**

| Phase | Work | Completion |
|---|---|---|
| 0 | Initial rework planning and repository setup | foundation laid |
| 1 | Merge Dashboard and Timeline into Overview (ADR-0025), update shell navigation | Overview at `/overview`, old routes redirect |
| 2 | .NET backend structure: Domain/Application/Infrastructure/Api layers with seeded fixture data | backend runs with `dotnet run --project api/src/ShiftOMator.Api -- --seed-demo` |
| 3 | Port coverage, validation, comp-day, candidate ranking engines to C# as the single implementation; add DraftService for server-side draft persistence | All domain logic now server-side; validation runs server-side on `POST /api/drafts/{id}/publish` |
| 4 | Add stubbed-but-real auth scaffold: bearer token, role claims, `[Authorize]` attribute on endpoints | identity available via `GET /api/auth/me`, endpoints gated by role |
| 5 | HTTP cutover: HttpScheduleRepository replaces in-memory store, all CRUD over REST; TanStack Query for server state, Zustand only for UI state and draft metadata; OpenAPI type generation | Frontend talks entirely to backend over `/api/*` endpoints; `npm run api:schema:check` validates type generation |
| 6 | Settings page with Admin surface for reference data (ADR-0021) | Settings at `/settings`, full CRUD, all mutations gated by the Admin role |
| 7–8 | Model rework: Region deleted, PlanningUnit becomes the single rule axis, Role and Shift collapse into one absolute-time entity, zero minimums legalised (ADR-0032/0033/0034) | Guarded by a frozen baseline comparison (`Phase8Baseline`) proving non-ST coverage and issues came out byte-identical |
| 9 | **Production readiness and self-service.** Actor identity from the token; one change history for every entity; scoped dataset loading; version tokens on absences and comp days; presence; requests, approvals and an in-app inbox; AI explanations (ADR-0039–0048) | The audit trail ADR-0032 depends on is now real and complete; the separate portal is absorbed |
| 10 | **One grid, configurable absences, half-days.** Event types as data; `portion` on absences and presence; the cell splits into chip and band; the grid is gated by role and carries self-service; approvers named per unit; a per-cell audit timeline; a switchable stub identity (ADR-0049–0050) | The role-blind grid — a live defect where a viewer's click did nothing and said nothing — is fixed; the schema is one migration again |

| 11 | **Roles, and the two flows.** Roles become a set granted per planning unit, with the ordinal comparison deleted and approval routes replaced by the `Approver` grant; drafts narrow to the rota, absences and presence become direct writes gated by approval; roster markers deleted; an absence fills the cell; comp days are placed by the person taking them (ADR-0051–0052) | An Admin can no longer assign shifts by accident of enum order, and a viewer can record their own sick day |

**Next: Phase 14 — first-run setup and maintenance ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)).**

What a fresh database starts as stops being a deployment decision and becomes a screen. A
system with no `SystemSetup` row answers `503 SETUP_REQUIRED` everywhere except
`/health/*` and `/api/setup/*`, and the browser shows a wizard: pick **Bare** (one
location, one unit, you as the global Admin, taken from your token) or **Demo** (the
fixture entire). Afterwards Settings → Maintenance carries the same two operations —
**Load demo data**, guarded on the system still being untouched, and **Reset to empty**,
which deletes rows in dependency order and hands the wizard back. `Seed:IncludeDemoData`,
`--seed-demo` and `Auth:BootstrapAdminEmail` are deleted; `--reset-db` stays as the
development recovery for a regenerated `InitialCreate`.

| Step | Work |
|---|---|
| 1 | `SystemSetup` entity, `InitialCreate` regenerated, `ScheduleDbContext` mapping with the fixed key |
| 2 | `SetupGateMiddleware` after authentication, before routing; the allowlist is `/health/*` and `/api/setup/*` |
| 3 | `SetupService` in Application: the two presets, the `Person`-from-claims path, the reset, and the delete order — pure enough to test against a real database, not spread across endpoints |
| 4 | `SetupEndpoints`: anonymous `GET /api/setup/state`, `POST /api/setup` (409 `SETUP_COMPLETE` once the row exists) |
| 5 | `MaintenanceAdminEndpoints`: load-demo and reset, `AdminSomewhere`, both through `ChangeAudit` |
| 6 | Client: `SetupGate` above `AuthProvider` (the state call carries no token), the wizard screen, and Settings → Maintenance with the typed confirmation |
| 7 | Delete the flags: `Program.cs`, `appsettings*.json`, `values.yaml`, `values-*.yaml`, `compose.yaml`, `deploy/README.md`, and the `BootstrapAdminAsync` path in the seeder |
| 8 | Tests: reset → demo → reset (proves the delete order), the gate's allowlist, `409` on a second setup, and the demo button's guard |

**Remaining, not yet scheduled:**

- **Half-day shifts, and half coverage.** Today a half-day absence beside a shift is a
  flagged conflict, because coverage is whole-day and there is no way to express "off this
  morning, working this afternoon" as a roster. The fix is shifts that carry halves, so
  coverage counts halves and the combination can then be forbidden outright. ADR-0050
  rejected this on the grounds that the boundary hour would be invented; that argument is
  weaker than it looked — the boundary is derivable from the shift's own window. What
  actually blocks it is integer minimums running through `CoverageCalculator`, `Validator`,
  the coverage strip, `IssueDigest` and their tests ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

- **Real Entra ID.** The seam exists and the policy surface is real, but the JWT branch has
  no `Auth:Jwt` configuration, no `roles` array-claim mapping and no tested path. Until it
  lands, the stub issues a **switchable** identity: `Auth:StubPersonId` pins one, and the
  `X-Debug-PersonId` / `X-Debug-Role` headers override per request so role behaviour can
  be tested without a restart. `X-Debug-Role` is comma-separated, because roles are a set;
  the literal `Viewer` strips an account to nothing, and an absent header means "use their
  real grants". The in-app switcher uses only the person header — grants belong on
  Settings → Roles, and a global override was a state the product cannot produce. Those headers are read only by `StubAuthenticationHandler`,
  which exists only in stub mode.
- **`Person.externalObjectId`** — the column that links a token to a roster row. Without
  it, a real IdP has nothing to map onto.
- **External notification delivery** — the outbox columns exist and are unused; Phase B is
  one in-process dispatcher sending via Graph ([ADR-0044](adr/0044-in-app-inbox-first.md)).
- **Admin screens for event types and request types.** Both are ordinary tables with a
  seeded starting set, so adding one is a row — but until the Settings cards exist, that
  row is added in the seed or the database. Approval routes no longer need a screen: who
  approves is the `Approver` grant, edited on Settings → Roles.
- **Export** — XLSX, CSV, ICS, print with timezone stamping.
- **Effective-dated configuration editing** — Settings UI for changing minimums and shifts
  with past-data protection.
- **Rate limiting and observability** — `Docs/12` states per-endpoint targets that nothing
  enforces, and structured logging is default-console only.
- **Mobile and tablet.** There are no touch or pointer handlers anywhere; painting, range
  selection and the scrubber are mouse-only, and the side panels are fixed-width. Below
  1024px the product is read-only by accident rather than by design.

## Original Frontend-MVP roadmap (stages 1–14, superseded by phases 0–6)

These stages built the layout and interaction patterns that remain. They are no longer
the implementation timeline but the feature checklist.

| # | Stage | Feature | Status |
|---|---|---|---|
| 1–3 | Model rework + draft lifecycle | Corrected domain model, real shifts/minimums, draft sessions with changes, undo/redo | ✅ Completed in Phase 1–3 |
| 4 | Schedule grid | Grouping by location/unit/category, shift chips, markers, eligible-shift picker | ✅ In production |
| 5 | Coverage strip | Aggregate row + per-shift detail (the point it beats Excel) | ✅ In production |
| 6 | Review and publish | Diff, impact summary, conflict reconciliation, atomic publish | ✅ In production |
| 7 | Absences and comp days | Range entry, window-based accrual, balance, import | ✅ In production |
| 8 | Overview | Summary stats, gap alerts, timeline — merged with 11 | ✅ In production (merged, Phase 1) |
| 9 | People | Roster table, KPIs, fairness, shift-mix, preference editor | ✅ In production |
| 10 | Settings | Admin surface for reference data, including role grants | ✅ Full CRUD in production (event types and request types have no card yet) |
| 11 | Timeline and day drill-down | Continuous timeline in Overview, per-person day view | ✅ In production (merged, Phase 1) |
| 12 | Zoom levels | Month, plus quarter and half-year read-only heatmaps | ✅ In production (day and week zooms removed by ADR-0036) |
| 13 | Suggest and auto-populate | Ranked candidates, locked cells, explanations | ✅ In production |
| 14 | Absence import | Paste, mapping, diff, impact, batch rollback | ✅ In production |
| 15 | Presence | Where people work, as a range entity; delta rendering; on-site/remote counts | ✅ In production (Phase 9) |
| 16 | Requests and approvals | Configurable types, materialization, withdrawal. Routing became the `Approver` grant in Phase 11 | ✅ In production (Phase 9) |
| 17 | Inbox | In-app notifications written transactionally; bell in the shell | ✅ In production (Phase 9) |
| 18 | Configurable event types | Kinds of absence as data: vacation, sick, floating holiday, personal day, unpaid leave, furlough | ✅ In production (Phase 10) |
| 19 | Half-days | `portion` on absences and presence; the cell splits to show it | ✅ In production (Phase 10) |
| 20 | One grid for everybody | Editability by role; self-service from the grid; approve from the picker; cell audit timeline | ✅ In production (Phase 10) |

## Key decisions preserving the frontend MVP design

- [ADR-0014](adr/0014-own-grid-and-timeline.md): Hand-built grid and timeline, not AG Grid
- [ADR-0022](adr/0022-tailwind-for-tokens-and-layout.md): Tailwind v4 for tokens and layout
- [ADR-0023](adr/0023-editing-arms-itself.md): Any cell edit opens a draft, no explicit Edit mode
- [ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md): Presence bypasses the
  draft — it is the one grid-adjacent edit that deliberately does not arm one
- [ADR-0025](adr/0025-overview-replaces-dashboard-and-timeline.md): Dashboard and Timeline merged into Overview
