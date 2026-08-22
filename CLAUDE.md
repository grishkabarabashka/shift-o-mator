# shift-o-mator — project context

A shift-planning tool for a global application support team (~80 people across four
planning units: `unit-amer`, `unit-emea`, `unit-apac`, and the cross-cutting
`unit-st` for Service Transition). Replaces manual planning in a shared Excel file.


## State of the code

Phases 0–6 complete the HTTP cutover: the backend is built and tested, domain logic
lives server-side, and the frontend talks entirely over REST. Code and design agree.

The repo is a monorepo: `apps/web` (frontend) and `apps/api` (backend), an npm
workspace root at the repository root with no other members.

**Frontend** (`apps/web/src/`):

- `domain/` — types only (no fixtures; seeded on backend)
- `engine/` — client-side utilities: `dates` (parsing, formatting), `period` (zoom and
  range arithmetic), `timeline` (layout and rendering), `cellValue` (projection logic)
- `data/` — `ScheduleRepository` interface and `HttpScheduleRepository` (REST client)
- `store/` — `useSchedule` (draft metadata), `useUi` (selection, range, dialogs)
- `api/` — TanStack Query hooks, OpenAPI-generated types (`schema.d.ts`)
- `features/` — `planning` (grid, `ShiftPalette`), `coverage` (strip), `issues` (panel),
  `absences`, `compdays`, `shell` (navigation, context, the location clock strip),
  `settings` (admin UI)
- `pages/` — `OverviewPage`, `SchedulePage`, `DayDrilldownPage`, `PeoplePage`,
  `SettingsPage`; routed in `App.tsx`
- `ui/` — Radix UI wrappers, `theme.css` (Tailwind tokens), shared styles
- `auth/` — `AuthProvider`, stub identity for development

**Backend** (`apps/api/src/`):

- `ShiftOMator.Domain` — entities and enums (mirrors `apps/web/src/domain/types.ts`)
- `ShiftOMator.Application` — engines (coverage, validation, ranking, comp days,
  auto-populate), services (drafts), helpers
- `ShiftOMator.Infrastructure` — EF Core `ScheduleDbContext`, migrations, seeding
- `ShiftOMator.Api` — minimal APIs, DTOs, auth scaffold, OpenAPI emission

**Tests:**

- Frontend: `apps/web/src/**/*.test.ts` (Vitest)
- Backend: `apps/api/tests/**/*.cs` (xUnit)

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
# Frontend (from the repo root — npm workspace delegates to apps/web)
npm run typecheck
npm run test:run
npm run build
npm run api:schema:check      # type generation has not drifted

# Backend (from apps/api/)
dotnet build
dotnet test
```

## Key decisions (don't revisit without a new ADR)

1. **A shift carries its own absolute time**, in a fixed timezone. `Crew` is
   09:00–18:00 America/Chicago, which renders as 10:00–19:00 in New York — one absolute
   window. Everyone holding this shift works that interval; there is no location-specific
   variation. (ADR-0033, supersedes ADR-0001 and ADR-0018)

2. **A location is responsible only for** the calendar of weekends and holidays and for
   display timezone. Nothing to do with shift timing. (ADR-0002)

3. **PlanningUnit is the single rule axis.** One entity answers both questions: which
   rules apply (coverage, shifts, day configurations, comp-off policy) and whose screen
   this person appears on. There are four units: `unit-amer`, `unit-emea`, `unit-apac`
   (REGION kind) and `unit-st` (CROSS_REGION kind). A unit is a **default filter, not a
   hard boundary**; the Schedule screen offers a toggle to view all people with shifts in
   that unit. **No unit scoping of write access** — everyone can plan anywhere, and the
   control is a complete audit trail. (ADR-0032, supersedes ADR-0004 and ADR-0020)

4. **Shifts belong to a unit.** No global catalog; matching codes across units are
   coincidental. (ADR-0032, narrowing ADR-0004)

5. **Day configurations carry shift sets, not just minimums.** unit-amer Mon–Thu runs `Lead`
   and `Crew`; Friday runs `Lead-E`, `Crew-E`, `Crew-L` — different shifts. An event
   (DR test) is a dated day configuration. (ADR-0016, ADR-0008)

6. **No work-pattern entity**; `availableWeekdays` is a person field read only by
   auto-populate. **The shift that absorbs everyone on an ordinary day belongs to the
   day configuration**, not to the person: the requirement marked `isDefault` with no
   `max`. `Person.defaultShiftId` survives only as an exception (Service Transition,
   whose engineers hold one shift each) and is null for everyone else — engineers do not
   have a default shift, they have shifts they cannot do. Managers are
   `orgCategory = MANAGEMENT` with `isIncluded = false`. (ADR-0038, narrowing ADR-0005)

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
    `THIN` as a distinct coverage state. **Nothing but BLOCKING blocks.** A conflict
    (coming in during your own leave), a gap (an unfilled minimum), and an
    unacknowledged warning are all decisions still to be made, not corrupt data —
    none of them stop a publish. Acknowledging a warning with a comment is still a
    real, kept record ("how often did we have to break the rule, and why"), it's
    just no longer a precondition. All three stay visible and highlighted
    everywhere (coverage strip, Overview, issues panel); only a double assignment
    and an unknown/ineligible shift stay BLOCKING. (ADR-0009, ADR-0024, ADR-0035,
    ADR-0037)

12. **Absence limits apply per unit and per shift pool.** Three of four possible leads
    being out is invisible to a headcount counter. Not present in the prototype — it is
    the owner's rule; 3 long / 4 short per unit are confirmed defaults. (ADR-0010)

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

18. **Zero minimums are a legal coverage state.** A unit (Service Transition, for one)
    may carry shifts with `min=0` — no hard requirement. This never renders as a gap
    or understaffed cell. (ADR-0034)

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
- Cell interaction: right-click opens a picker with **only the shifts in that day's
  configuration that this person is eligible for**, plus Non-working and Clear. The
  shift palette (`ShiftPalette`, filtered to the selected planning unit) and hotkeys
  are the fast path for painting ranges. **Any edit opens the draft by itself** — there
  is no Edit mode to enter (ADR-0023)
- **Overview and Schedule hold independent periods**, not one shared zoom (ADR-0036).
  Overview is a fixed 1/3/7-day window centered on "now"; Schedule's shortest zoom is
  a month (`month` / `quarter` / `half-year`). Each screen remembers its own slice in
  `useUi` (`overview` / `schedule`) and writes the single active `useUi.range` on
  mount (`enterOverview()` / `enterSchedule()`); every other consumer — data loading,
  `usePlanningView`, coverage — still just reads `range`. There is no arbitrary custom
  range anymore; the day strip and year scrubber only jump the anchor. All the period
  arithmetic lives in `engine/period.ts`.
- **A person's `employeeId` is a unique external key** once set (filtered unique index;
  `null` is unconstrained) — the field an eventual HR import will match people by.
  `AbsenceImportDialog`'s client-side `matchPeople` already tries it first.

## Open questions

**All eight are closed** — five by the prototype spec, three by the owner. See
`Docs/14-open-questions.md` for the record, so they are not reopened by accident.

Remaining `ASSUMPTION` values in fixtures (chosen, not confirmed, cheap to change):
`agingThresholdDays` = 14, role-pool absence limits = 1, comp-off search window, role
colors and hotkeys.
