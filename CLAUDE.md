# shift-o-mator — project context

A shift-planning tool for a global application support team (~80 people, 3 regions:
AMER, EMEA, APAC). Replaces manual planning in a shared Excel file.


## State of the code

Phases 0–6 complete the HTTP cutover: the backend is built and tested, domain logic
lives server-side, and the frontend talks entirely over REST. Code and design agree.

**Frontend** (`src/`):

- `domain/` — types only (no fixtures; seeded on backend)
- `engine/` — client-side utilities: `dates` (parsing, formatting), `period` (zoom and
  range arithmetic), `timeline` (layout and rendering), `cellValue` (projection logic)
- `data/` — `ScheduleRepository` interface and `HttpScheduleRepository` (REST client)
- `store/` — `useSchedule` (draft metadata), `useUi` (selection, range, dialogs)
- `api/` — TanStack Query hooks, OpenAPI-generated types (`schema.d.ts`)
- `features/` — `planning` (grid), `coverage` (strip), `issues` (panel), `absences`,
  `compdays`, `shell` (navigation and context), `settings` (admin UI)
- `pages/` — `OverviewPage`, `SchedulePage`, `DayDrilldownPage`, `PeoplePage`,
  `SettingsPage`; routed in `App.tsx`
- `ui/` — Radix UI wrappers, `theme.css` (Tailwind tokens), shared styles
- `auth/` — `AuthProvider`, stub identity for development

**Backend** (`api/src/`):

- `ShiftOMator.Domain` — entities and enums (mirrors `frontend/domain/types.ts`)
- `ShiftOMator.Application` — engines (coverage, validation, ranking, comp days,
  auto-populate), services (drafts), helpers
- `ShiftOMator.Infrastructure` — EF Core `ScheduleDbContext`, migrations, seeding
- `ShiftOMator.Api` — minimal APIs, DTOs, auth scaffold, OpenAPI emission

**Tests:**

- Frontend: `src/**/*.test.ts` (Vitest)
- Backend: `api/tests/**/*.cs` (xUnit)

Two traps worth knowing before touching the UI:

- **Class names collide with Tailwind utilities.** `grid` and `table` are utilities;
  the planning grid root is `.sheet` and data tables are `.rows` for that reason
  (ADR-0022). Check any new component class against the utility namespace.
- **The planning grid is performance-sensitive.** ~2500 cells. `GridCell` is memoized
  on primitives, and there is exactly **one** context menu for the whole grid
  (`AssignmentPicker`). Do not put a Radix root, a tooltip or a new object prop inside
  a cell.

**UI text and documentation are English.** In-code comments follow this rule:
C# XML documentation on the backend is always English; existing TypeScript is left
alone rather than churned for language consistency — the codebase has Russian and
English mixed, and unifying it is out of scope.

**Verify with:**

```bash
# Frontend
npm run typecheck
npm run test:run
npm run build
npm run api:schema:check      # type generation has not drifted

# Backend (from api/ directory)
dotnet build
dotnet test
```

## Key decisions (don't revisit without a new ADR)

1. **A role carries its own time**, in the role's fixed timezone. `Crew` is
   09:00–18:00 America/Chicago, which renders as 10:00–19:00 in New York — one absolute
   window. Separately, **a `ShiftDefinition` is the person's contracted window**
   (Pune EMEA shift 13:00–21:30 IST). Coverage and timelines use role time; People and
   roster context use shift time. (ADR-0001, ADR-0018)

2. **A location is responsible only for** the calendar of weekends and holidays and for
   display timezone. Nothing to do with role timing. (ADR-0002)

3. **Region and planning unit are two orthogonal axes.** Region = which rules apply
   (AMER includes New York, Chicago, Hartford, Pune). Planning unit = whose screen —
   either a region's roster or a cross-region team such as Service Transition. A person
   has both. A unit is a **default filter, not a boundary**; coverage is always computed
   per region. **No regional scoping of write access** — everyone can plan anywhere, and
   the control is a complete audit trail. **`ALL_UNITS` is the default everywhere**: the
   question people open this for is global. (ADR-0020, ADR-0025)

4. **Roles belong to a region.** No global catalog; matching codes across regions are
   coincidental. (ADR-0004)

5. **Day configurations carry role sets, not just minimums.** AMER Mon–Thu runs `Lead`
   and `Crew`; Friday runs `Lead-E`, `Crew-E`, `Crew-L` — different roles. An event
   (DR test) is a dated day configuration. (ADR-0016, ADR-0008)

6. **No work-pattern entity**; `defaultRoleId` and `availableWeekdays` are person
   fields read only by auto-populate. Managers are `orgCategory = MANAGEMENT` with
   `isIncluded = false`. (ADR-0005)

7. **Eligibility holds target shares.** Target share is the fairness *metric*;
   candidate *ordering* is eligibility → availability → fewest in 90 days → recency →
   personal targets. (ADR-0006)

8. **A comp day is an accrual with a balance**, placed by a **search window**
   (`windowBefore`/`windowAfter`, excluded weekdays — Mon and Fri by default,
   earliest free eligible date), not a fixed offset. No valid slot →
   `PENDING_APPROVAL`, never dropped. Saturday and Sunday earn separately.
   **Comp days never expire** — a configurable `agingThresholdDays` flags anything
   outstanding too long: manager alert plus a standing notice for the person.
   (ADR-0007)

9. **Absence is a range; the grid cell is a projection.** Leave lives as
   `Absence{from,to}` with type `VACATION | SICK | OTHER`; roster decisions live as
   `Assignment` markers `OFF` / `NOT_SCHEDULED`; `0` ≠ blank. One pure function
   resolves precedence into a `CellValue`. **`Training` is not an absence** — in-hours
   training is the `Cover` role and counts toward coverage. (ADR-0017)

10. **Exactly one assignment per (person, date).** No split shifts, no parallel duty;
    on-call is an ordinary role code occupying the day. Hard constraint.

11. **Three validation levels**, with gap and conflict as separate categories and
    `THIN` as a distinct coverage state. Soft rules never block; they require an
    acknowledgement with a comment. **A conflict does not block either** — coming in
    during your own leave is a decision, not corrupt data. Only a double assignment
    and an unknown/out-of-region role stay BLOCKING. (ADR-0009, ADR-0024)

12. **Absence limits apply per region and per role pool.** Three of four possible leads
    being out is invisible to a headcount counter. Not present in the prototype — it is
    the owner's rule; 3 long / 4 short region-wide are confirmed defaults. (ADR-0010)

13. **Optimistic drafts, not locking.** `DraftSession` + ordered `DraftChange`;
    concurrent drafts allowed with an informational banner; atomic publish; version
    conflict → compare/refresh/reapply. A failed publish **never** clears the draft.
    Published data is what viewers see. (ADR-0015, supersedes ADR-0011)

14. **Configuration is effective-dated.** Raising a minimum today must not make last
    March fail. Coverage resolves the configuration version effective on the date being
    evaluated. Colors and labels are not versioned. (ADR-0021)

15. **`ScheduleRepository` is the single data boundary**, every method async from day
    one. (ADR-0012)

16. **Headless UI** (Radix + own styles) so the shell can be swapped for the corporate
    component library. (ADR-0013)

17. **Grid and timeline are hand-built.** The prototype chose AG Grid, then needed
    `@dnd-kit` separately for drag interactions that never shipped. Its dimensions are
    adopted: 185px person column, 62px date columns, 26px rows. (ADR-0014)

## Technical decisions

- Frontend: React 19 + Vite + TypeScript (strict), react-router, TanStack Query for
  server state, Zustand for draft/UI state, Luxon for dates, Radix for behavior,
  Tailwind v4 for tokens and layout (ADR-0022), Vitest
- Backend: .NET 10 + EF Core 10 + SQL Server (LocalDB in dev) + stubbed auth
  (Entra ID in production); xUnit tests; OpenAPI schema with generated types
- Frontend layering is strictly downward: `features → store → api → data → engine → domain`.
  Backend layering: `Api → Application → Infrastructure → Domain`. Domain logic
  executes server-side only
- One date library. Mixing in the native `Date` across eight locations produces DST bugs
- Cell interaction: right-click opens a picker with **only the roles in that day's
  configuration that this person is eligible for**, plus Non-working and Clear. The
  role palette and hotkeys are the fast path for painting ranges. **Any edit opens the
  draft by itself** — there is no Edit mode to enter (ADR-0023)
- The visible period is one piece of state (`useUi.range`) driven three ways — zoom
  buttons, day strip, year scrubber — and all the arithmetic lives in `engine/period.ts`

## Open questions

**All eight are closed** — five by the prototype spec, three by the owner. See
`Docs/14-open-questions.md` for the record, so they are not reopened by accident.

Remaining `ASSUMPTION` values in fixtures (chosen, not confirmed, cheap to change):
`agingThresholdDays` = 14, role-pool absence limits = 1, comp-off search window, role
colors and hotkeys.
