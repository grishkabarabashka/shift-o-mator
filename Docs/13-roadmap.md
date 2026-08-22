# Roadmap and Phase History

## Current state: Phases 0–6 complete

The first Frontend-only MVP built roadmap stages 1–14 above an in-memory fixture layer.
Phases 0–6 reworked the entire stack to move domain logic to a real backend and align
the frontend to the specification of an earlier corporate implementation.

**Phases completed:**

| Phase | Work | Completion |
|---|---|---|
| 0 | Initial rework planning and repository setup | foundation laid |
| 1 | Merge Dashboard and Timeline into Overview (ADR-0025), update shell navigation | Overview at `/overview`, old routes redirect |
| 2 | .NET backend structure: Domain/Application/Infrastructure/Api layers with seeded fixture data | backend runs with `dotnet run --project api/src/ShiftOMator.Api -- --seed-demo` |
| 3 | Port coverage, validation, comp-day, candidate ranking engines to C# as the single implementation; add DraftService for server-side draft persistence | All domain logic now server-side; validation runs server-side on `POST /api/drafts/{id}/publish` |
| 4 | Add stubbed-but-real auth scaffold: bearer token, role claims, `[Authorize]` attribute on endpoints | identity available via `GET /api/auth/me`, endpoints gated by role |
| 5 | HTTP cutover: HttpScheduleRepository replaces in-memory store, all CRUD over REST; TanStack Query for server state, Zustand only for UI state and draft metadata; OpenAPI type generation | Frontend talks entirely to backend over `/api/*` endpoints; `npm run api:schema:check` validates type generation |
| 6 | Settings page with Admin surface for reference data; read-only pending effective-dated configuration editing (ADR-0021) | Settings at `/settings`, all mutations gated by Admin role |

**Remaining stages (original roadmap 15–16, not yet scheduled):**

- **Export** — XLSX, CSV, ICS, print with timezone stamping — client-side or backend supported
- **Effective-dated configuration editing** — Settings UI for changing minimums, roles, etc. with past-data protection

## Original Frontend-MVP roadmap (stages 1–14, superseded by phases 0–6)

These stages built the layout and interaction patterns that remain. They are no longer
the implementation timeline but the feature checklist.

| # | Stage | Feature | Status |
|---|---|---|---|
| 1–3 | Model rework + draft lifecycle | Corrected domain model, real roles/minimums, draft sessions with changes, undo/redo | ✅ Completed in Phase 1–3 |
| 4 | Schedule grid | Grouping by location/region/category, role chips, markers, eligible-role picker | ✅ In production |
| 5 | Coverage strip | Aggregate row + per-role detail (the point it beats Excel) | ✅ In production |
| 6 | Review and publish | Diff, impact summary, conflict reconciliation, atomic publish | ✅ In production |
| 7 | Absences and comp days | Range entry, window-based accrual, balance, import | ✅ In production |
| 8 | Overview | Summary stats, gap alerts, timeline — merged with 11 | ✅ In production (merged, Phase 1) |
| 9 | People | Roster table, KPIs, fairness, role-mix, preference editor | ✅ In production |
| 10 | Settings | Admin surface for reference data | ✅ Read-only in production |
| 11 | Timeline and day drill-down | Continuous timeline in Overview, per-person day view | ✅ In production (merged, Phase 1) |
| 12 | Zoom levels | Day/week/month and 3/6-month read-only heatmap | ✅ In production |
| 13 | Suggest and auto-populate | Ranked candidates, locked cells, explanations | ✅ In production |
| 14 | Absence import | Paste, mapping, diff, impact, batch rollback | ✅ In production |

## Key decisions preserving the frontend MVP design

- [ADR-0014](adr/0014-own-grid-and-timeline.md): Hand-built grid and timeline, not AG Grid
- [ADR-0022](adr/0022-tailwind-for-tokens-and-layout.md): Tailwind v4 for tokens and layout
- [ADR-0023](adr/0023-editing-arms-itself.md): Any cell edit opens a draft, no explicit Edit mode
- [ADR-0025](adr/0025-overview-replaces-dashboard-and-timeline.md): Dashboard and Timeline merged into Overview
