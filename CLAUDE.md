# shift-o-mator — project context

A shift-planning tool for a global application support team (~80 people, 3 regions:
AMER, EMEA, APAC). Replaces manual planning in a shared Excel file.

## Read this first

`SHIFT-O-MATOR-desc-anonymized.md` at the repo root is the sanitized specification of
an **earlier corporate implementation of this same product**. It is the authority on
operational reality: real role codes, real coverage minimums, real status vocabulary,
the draft/publish model. When this design and that document disagree, that document
wins unless there is an ADR explaining why not.

`Docs/` was rewritten against it. Several early decisions were reversed — see
ADR-0015…0019.

## State of the code

Code and design agree. Roadmap stages 1–12 are built; 13–16 (suggest/auto-populate,
absence import, export, backend) are not, and Settings is read-only pending
effective-dated editing.

Layout:

- `domain/` — types, fixtures with the **real** role codes, draft changes, lookup index
- `engine/` — pure: `dates`, `period` (zoom and range arithmetic), `dayConfig`,
  `cellValue` (cell precedence), `coverage`, `compDays`, `validate`, `timeline`
- `data/memoryRepository.ts` — published/draft split, sessions, version conflicts
- `store/` — `useSchedule` (data + draft), `useUi` (selection, period, dialogs)
- `features/` — `planning`, `coverage`, `issues`, `absences`, `compdays`, `shell`
- `pages/` — Dashboard, Schedule, Timeline, People, Settings; routed in `App.tsx`
- `ui/` — `theme.css` (tokens, Tailwind, component classes), `grid.css`, `primitives.tsx`

Two traps worth knowing before touching the UI:

- **Class names collide with Tailwind utilities.** `grid` and `table` are utilities;
  the planning grid root is `.sheet` and data tables are `.rows` for that reason
  (ADR-0022). Check any new component class against the utility namespace.
- **The planning grid is performance-sensitive.** ~2500 cells. `GridCell` is memoized
  on primitives, and there is exactly **one** context menu for the whole grid
  (`AssignmentPicker`). Do not put a Radix root, a tooltip or a new object prop inside
  a cell.

`Docs/13-roadmap.md` has the stage table.

**UI text and documentation are English.** Only the conversation with the user and
in-code comments stay Russian — see the user's global CLAUDE.md.

Verify with: `npm run typecheck`, `npm run test:run`, `npm run build`.

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
   the control is a complete audit trail. (ADR-0020, supersedes ADR-0019)

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

11. **Three validation levels**, with gap and conflict as separate categories inside
    BLOCKING, and `THIN` as a distinct coverage state. Soft rules never block; they
    require an acknowledgement with a comment. (ADR-0009)

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

- React + Vite + TypeScript (strict), react-router, Zustand for the draft, Luxon for
  dates, Radix for behavior, Tailwind v4 for tokens and layout (ADR-0022), Vitest
- Target backend: .NET + EF Core + SQL Server + Entra on AKS. MVP has none: in-memory
  repository over fixtures, persisted to IndexedDB
- Layering is strictly downward: `features → store → engine → domain`. Engines are
  pure, take the current instant as a parameter, and never touch storage
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
