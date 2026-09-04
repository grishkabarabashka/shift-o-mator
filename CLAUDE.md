# shift-o-mator — project context

A shift-planning and self-service tool for a global application support team (~80 people
across four planning units: `unit-amer`, `unit-emea`, `unit-apac`, and the cross-cutting
`unit-st` for Service Transition). Replaces manual planning in a shared Excel file — and,
since ADR-0047, the separate portal people used to record leave and remote days in.


## State of the code

Phases 0–6 completed the HTTP cutover; 7–8 were the model rework (Region deleted, one
absolute-time `Shift`); **Phase 9** made the product production-shaped and absorbed the
self-service portal; **Phase 10** made the grid one grid for everybody; **Phase 11**
rebuilt authorization (roles are a scoped set) and split the write paths (drafts publish
the rota; time off and presence are written directly and reviewed by approval);
**Phase 12** gave the UI a design language (elevation, measure, a type scale, real
breakpoints) and a feedback layer; **Phase 13** made Entra ID sign-in real and the app
deployable to AKS; **Phase 14** replaced the seeding flags with a first-run setup screen.
Since Phase 14, three decisions landed outside a phase: the model is a **deployment**,
not a vendor (ADR-0060); Settings saves people as **one batch** (ADR-0061); and directory
roles are **off by default**, so the database is the single source (ADR-0062); a setting
read per request is a **row**, not configuration (ADR-0063); and notifications have a
**policy matrix and a delivery log** (ADR-0064 — steps 1 and 2 of it; nothing is delivered
externally yet). Code and design agree; the ADR index is complete through 0064.

The repo is a monorepo: `apps/web` (frontend) and `apps/api` (backend), an npm
workspace root at the repository root with no other members.

**Frontend** (`apps/web/src/`):

- `domain/` — types only (no fixtures; seeded on backend)
- `engine/` — client-side utilities: `dates` (parsing, formatting), `period` (zoom and
  range arithmetic), `timeline` (layout and rendering), `cellValue` (projection logic),
  `presence` (a **second**, independent projection — see trap 3 below)
- `data/` — `ScheduleRepository` interface and `HttpScheduleRepository` (REST client)
- `store/` — `useSchedule` (draft metadata), `useUi` (selection, range, dialogs)
- `api/` — TanStack Query hooks, OpenAPI-generated types (`schema.d.ts`)
- `features/` — `planning` (grid, `ShiftPalette`), `coverage` (strip), `issues` (panel),
  `absences`, `compdays`, `presence`, `requests`, `shell` (navigation, context, the
  location clock strip, the notification bell), `settings` (admin UI)
- `pages/` — `OverviewPage`, `SchedulePage`, `DayDrilldownPage`, `PeoplePage`,
  `MyCalendarPage` (`/me`),
  `RequestsPage`, `SettingsPage` (admin-only: the nav hides it from anyone who
  administers nothing); routed in `App.tsx`
- `ui/` — Radix UI wrappers, `theme.css` (Tailwind tokens), shared styles
- `auth/` — `AuthProvider`, stub identity for development, `EntraGate` (MSAL sign-in) and
  `SetupGate` (the first-run wizard; sits between them — see ADR-0059)

**Backend** (`apps/api/src/`):

- `ShiftOMator.Domain` — entities and enums (mirrors `apps/web/src/domain/types.ts`)
- `ShiftOMator.Application` — engines (coverage, validation, ranking, comp days,
  auto-populate), services (drafts, requests), digests (`IssueDigest`,
  `CandidateDigest`), helpers
- `ShiftOMator.Infrastructure` — EF Core `ScheduleDbContext`, migrations, seeding
- `ShiftOMator.Api` — minimal APIs, DTOs, auth scaffold, OpenAPI emission

**Tests:**

- Frontend: `apps/web/src/**/*.test.ts` (Vitest)
- Backend: `apps/api/tests/**/*.cs` (xUnit)

Three traps worth knowing before touching the UI:

- **Class names collide with Tailwind utilities.** `grid` and `table` are utilities;
  the planning grid root is `.sheet` and data tables are `.rows` for that reason
  (ADR-0022). Check any new component class against the utility namespace.
- **The planning grid is performance-sensitive.** ~2500 cells. `GridCell` is memoized
  on primitives, and there is exactly **one** context menu for the whole grid
  (`AssignmentPicker`). Do not put a Radix root, a tooltip or a new object prop inside
  a cell. This is why presence arrives as two optional **strings**, not a `PresenceMark`.

- **`cellValue.ts` is a precedence chain, and presence is not in it.** `projectCells`
  resolves one winner per cell (shift > absence > comp day > holiday > marker).
  `projectPresence` is a *separate* map over the same keys, because a person can be on a
  shift **and** remote at once (ADR-0043). If a change to presence makes you want to edit
  `cellValue.ts`, the change is wrong.

`Docs/16-workflows.md` is the end-to-end view: every workflow, and the role each step
needs. Read it before changing anything about permissions or the write paths.

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
   that unit. Write access **is** scoped to a unit since ADR-0051 — a global grant covers
   the cross-unit planner the original rule was written for. (ADR-0032, supersedes
   ADR-0004 and ADR-0020; narrowed by ADR-0051)

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
   `Absence{from,to,eventTypeId}`. One pure function resolves precedence into a
   `CellValue`: shift > absence > comp day > holiday > empty. **An assignment is a
   shift** — the `OFF` / `NOT_SCHEDULED` markers are deleted, and an empty cell means no
   shift. An engineer declaring "do not schedule me that day" records the `UNAVAILABLE`
   event type, which is an absence. **`Training` is not an absence** — in-hours training
   is the `Cover` shift and counts toward coverage. (ADR-0017, markers deleted by
   ADR-0052)

9b. **One day, one record.** An approved request, or a direct write, **supersedes** what
    already covered those days — trimming the old range rather than deleting it, so the
    days it did not lose survive. Approving remote over an office week used to add a second
    row and let the projection render whichever it reached last, so the day did not change.
    `RangeSupersede` holds the arithmetic; a whole day beats anything, the same half beats
    itself, and a half never trims a whole day (that would discard the other half).
    **Changing the kind of leave is a new request, not an edit.** (ADR-0052)

9a. **Two write flows, and what decides is the thing, not the person.** Drafts publish
    the **rota** — shifts, and the comp-day accrual that comes with them. Everything else
    is written directly, with **approval** where the thing needs it: an `EventType` with
    `requiresApproval` cannot be written to `/api/absences` by anyone, planner included,
    and remote presence always goes through a request. Sick leave needs approval
    (reversing ADR-0049) and still does not count against capacity. A comp day is accrued
    by publishing and **placed** by the engineer asking for a day, which an approver signs
    off — `CompDayPlacement.Check` holds the rules so the client and the server cannot
    disagree about which dates are offered. (ADR-0052)

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
    concurrent drafts allowed; atomic publish; version conflict →
    compare/refresh/reapply. A failed publish **never** clears the draft. Published data
    is what viewers see. Cells staged in **another** planner's open draft are hatched grey
    and named in the tooltip (`GET /api/drafts/staged`, polled) — still not a lock, but
    the banner alone ("somebody else has this period open") was true and useless.
    (ADR-0015, supersedes ADR-0011)

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

19. **The acting person comes from the token, never a request body.** ADR-0032 removed
    write permissions on the grounds that the audit trail is the control; a body-supplied
    actor id made that trail forgeable by the people it constrains. `Auth/ActorResolver`
    resolves it and checks it against the roster — with a loud, deterministic fallback in
    stub mode, and a fail-closed 403 outside it. **DTOs must not carry an actor field.**
    (ADR-0039)

20. **One append-only history, for every entity.** `ChangeHistoryEntry` covers
    assignments, absences, comp days, presence and person edits. Draft publishes emit it
    from `DraftService`; direct writes emit it via `Auth/ChangeAudit`. A new write path
    with no history row is a bug. **The other admin CRUD endpoints still write none** —
    locations, units, shifts, day configurations, holidays, absence capacity rules — which
    is a live gap against this decision, not an exemption from it. (ADR-0040, ADR-0061)

20a. **Settings saves people as one unit.** `POST /api/admin/people/batch` applies every
    pending person edit or none: ops that *release* a unique value (`Email`, `EmployeeId`)
    are ordered before ops that claim it, and the whole batch runs in one transaction —
    SQL Server checks a unique index per *statement*, so a transaction alone does not fix
    the ordering. Moving a sign-in address between two people, sent row at a time, left the
    address on nobody and its owner locked out. Errors come back keyed by the op index the
    caller sent. An entity needs a batch when its rows can invalidate each other; only
    people currently can. (ADR-0061)

21. **Dataset loads are scoped by date, with a 120-day lookback.** The margin is
    load-bearing, not padding: `CandidateRanker` counts 90 days and `Validator` uses a
    rolling 91-day window, so trimming to the visible range would silently zero every
    fairness counter. History is never loaded into the dataset at all. (ADR-0041)

22. **Every mutable entity carries an `int Version`.** Absences and comp days used to be
    compared as serialized snapshots, which reported conflicts that had not happened and
    missed ones that had. The client must round-trip `version` untouched through a draft
    change. (ADR-0042)

23. **Presence is orthogonal to work, and never touches coverage.** A range entity like
    `Absence`, a *second* projection rather than a `CellValue` variant, rendered only as a
    **delta from the person's baseline**, and written directly rather than through a draft.
    A remote person on `Crew` covers `Crew`. (ADR-0043)

23a. **A way of working is a `PresenceType` row, and the set is open.** `PresenceRecord`
    carries a `typeId`; `PresenceKind` is deleted. The two things code used to branch on
    are columns: `namesALocation` (does it point at a `Location`, or carry free text) and
    `countsAs` (`OnSite | Remote | Away`, the coverage strip's headcount — a **closed**
    set, because a strip row cannot grow a column per type an admin invents). Full CRUD on
    Settings → Presence; **DELETE is refused once anything points at the type**, and says
    to untick Offered instead. A type that needs approving **owns a request type**, created
    and retired with it — otherwise ticking the box makes a menu item with nowhere to send
    the request. `requiresApproval` is enforced by the **server**
    (`APPROVAL_REQUIRED`, exactly as `/api/absences` does); it used to be one `if` in the
    cell menu, so any caller could write the record directly. `engine/presence.ts` draws
    `?` for a type it does not hold — a blank glyph reads as "nothing recorded".
    (ADR-0053, ADR-0054)

24. **Roles are a set, granted per planning unit.** `AppRole` is
    `Viewer | Planner | Approver | Admin` and **nothing is implied by ordering** — an Admin
    cannot assign shifts, a Planner cannot approve leave, and holding two roles grants both.
    The ordinal comparison that made `Admin > Planner` a licence to plan is deleted.
    `RoleAssignment{personId, unitId?, role}` is the grant; `unitId` null is global, which
    widens *scope*, never *privilege*. Grants live in the **database**, not the token —
    planning units are ours, and no IdP knows them. "Employee" is still the resource check
    `subjectPersonId == principal.personId`. `Capabilities` is the only place that answers
    "may this caller do X, here", and every question takes a unit. (ADR-0051, superseding
    the role model in ADR-0046)

24a. **Approval is a property of the thing, not of who asks.** A planner recording leave on
    somebody else's row raises a request like anybody else; `EventType.requiresApproval` and
    the remote presence kind decide. A planner owns the rota, not other people's time off.
    Whose inbox it lands in has one answer — the `Approver`s of the subject's unit, falling
    through to admins when a unit has none, because an empty inbox is the failure nobody
    notices. `ApprovalRoute` and multi-step approval are **deleted**. (ADR-0051)

25. **A request's envelope is generic; its outcome is typed.** Adding a request type is a
    row, not a deployment — but an approval writes a real `Absence` or `PresenceRecord`,
    because the engines read typed rows. `APPROVED` and `APPLIED` are separate states:
    approval is a human decision, application is a write that can fail. (ADR-0045)

26. **Notifications are rows written in the same transaction as the change.** No queue, no
    worker, no send — which is exactly why one cannot be lost. (ADR-0044)

26a. **What gets sent is a matrix; what was sent is a log.** `NotificationChannel` is a
    **closed** set (`InApp | Email | Teams`) because every member is a sender somebody has
    to write; `NotificationKind` is likewise code. What is data is the cell where they
    cross — `NotificationRule{kind, channel, enabled, userOverridable}`, topped up per row
    at startup so a kind added in code appears on Settings → Notifications by itself.
    **In-app is not a cell**: the `Notification` row *is* the inbox, and a checkbox for it
    would switch off the only place an event is visible. The outbox columns on
    `Notification` are **deleted** in favour of a child `NotificationDelivery`, because one
    row per notification cannot say "email *and* Teams". **The fan-out happens when the
    notification is written, not when it is sent** (`NotificationFanout.Plan`, pure, in
    `Application`; `Notifier.NotifyAsync`, the write, in `Infrastructure` — `Application`
    cannot hold a `DbContext`), so the rows record the policy in force at the moment of the
    event and a later edit to the matrix does not rewrite what is queued. **`Skipped` is
    written, never omitted**: without it a missing row means both "not owed one" and "lost
    one", and the admin log — which exists to answer "why did this person not get the
    email" — cannot tell them apart. Nothing sends yet; enabled cells accumulate `Pending`.
    Retry never resets `Attempts`. (ADR-0064)

27. **AI phrases a deterministic digest and never decides.** `IssueDigest` and
    `CandidateDigest` compute the answer in Application, pure and tested; the model only
    writes the sentence, under a prompt forbidding any fact not in the digest.
    `/api/insights/candidate-explanation` answers **with or without** a model. When every
    ranking criterion ties, the honest answer is "arbitrary" — say that, never invent a
    reason. Nothing AI-driven may write to published data. (ADR-0048)

28. **Leave entitlement is not modelled, and must not be.** The product records that leave
    was asked for and granted; it does not compute balances, accrual or carry-over. If a
    balance question ever needs answering here, integrate or buy. (ADR-0047)

29. **Kinds of absence are data, and `EventType` has no `countsAsCoverage` field.** If it
    counts as coverage it is a `Shift` — which is why `CoverageCalculator` is untouched by
    an admin adding a leave type. Behaviour comes from `blocksAssignment`,
    `countsTowardCapacity`, `requiresApproval`, `allowsHalfDay`. Sickness **needs**
    approval (ADR-0052 reversing ADR-0049) and is still *not* counted against capacity.
    The only seeded type needing no approval is `UNAVAILABLE` — a declaration of
    availability, not a request for time. On the client `CellStatus` is closed
    (`PH | COMP_OFF | ABSENT`) and carries the detail in `CellValue.event`. (ADR-0049,
    ADR-0052)

30. **One grid, editability by role.** `useCapabilities()` gates it; the picker stays a
    single menu whose contents follow the role. Non-planners raise requests and record
    presence from their own row and read any cell's history. Before this the grid was
    role-blind and a viewer's click did nothing and said nothing. (ADR-0050)

31. **Half-days are a `portion`, never a time.** `FULL | MORNING | AFTERNOON` on `Absence`
    and `PresenceRecord`. **Coverage stays whole-day** — comparing a half against a shift
    window needs a boundary hour, and any hour we picked would be invented. The
    one-assignment-per-(person, date) invariant is untouched. (ADR-0050)

32. **The cell is two stacked rows**: chip on top, band underneath (absence when a shift
    is present, presence, pending request), row height 32px. A pending request is always
    dashed — a proposal must never read as a fact. Presence is drawn for **every** recorded
    day, coloured by kind, quieter when it matches the person's baseline. The earlier
    "draw only a departure from the baseline" rule was reversed: records are sparse, so it
    hid the only ones there were. (ADR-0050, amending ADR-0043)

33. **What the grid draws is layered** — Shifts / Time off / Presence / Requests, toggled
    in the toolbar, masked at render rather than in the projection. There are no
    `+ Absence` / `+ Presence` toolbar buttons: right-click does both in one click on the
    cells already selected. (ADR-0050)

34. **Light is information, measure is focus.** Elevation is a ladder of five (`--elev-0`
    … `--elev-4`) with one rule: **exactly one surface per screen sits on `--elev-2`**, the
    one the screen exists for. In dark mode elevation inverts its *mechanism* — a lit top
    edge, because a shadow on a `#0b0e13` canvas has no light to block. Only the planning
    grid is full-bleed; My calendar and Requests are measured and centred, which is what
    makes the grid read as the instrument. The header clocks carry their own sky from
    `skyPhase`, which shares `nightBands`' constants so the header and Overview's axis
    cannot disagree about what night is — and `--sky-*` is a **separate** family from the
    semantic palette, because a sunset drawn in `--warn` would read as a warning about
    Chicago. Narrow viewports get a different *control*, never a missing one. (ADR-0057)

35. **Success has a channel, and failure keeps its own.** `ui/toasts.ts` plus one
    `ToastViewport` (`role="status"` for success, `role="alert"` for failure — before this
    there was no live region anywhere). It does **not** replace the three failure surfaces:
    a failed publish keeps its banner, because that message belongs beside the draft it is
    about, and field errors stay at their fields. **Toasts are raised from `features`,
    never from `store`** — the layering runs downward, and `store` reaching into `ui` is
    the first edge going the wrong way. `ui/ErrorBoundary.tsx` is the one class component
    in the codebase; `getDerivedStateFromError` has no hook equivalent. (ADR-0057)

## Technical decisions

- Frontend: React 19 + Vite + TypeScript (strict), react-router, TanStack Query for
  server state, Zustand for draft/UI state, Luxon for dates, Radix for behavior,
  Tailwind v4 for tokens and layout (ADR-0022), Vitest
- Backend: .NET 10 + EF Core 10 + SQL Server (LocalDB in dev) + stubbed auth
  (Entra ID in production); xUnit tests; OpenAPI schema with generated types
- **The schema is one migration.** There is no production data yet, so `InitialCreate` is
  regenerated rather than appended to. Once real data exists this stops being true and
  migrations become incremental again. **Regenerating it invalidates every existing
  database** — EF sees a migration id it does not know and tries to create tables that are
  already there. Startup refuses with a message naming the fix
  (`EnsureSchemaIsReconcilableAsync`) instead of the opaque
  `There is already an object named 'Absences'`, and **`--reset-db`** drops and rebuilds.
  **Every test database needs a reason, and there are more of them than this paragraph
  used to admit** — `ShiftOMatorPeopleBatchTests` and six `ShiftOMatorSetupDiag*` are also
  real databases that outlive a run. The reliable way to find them all before regenerating
  the schema is `SELECT name FROM sys.databases WHERE name LIKE 'ShiftOMator%'`, and to
  drop every one of them except the dev database `ShiftOMator` itself.
  `ShiftOMatorTests` is shared by almost everything; `ShiftOMatorPersonEmailTests`,
  `ShiftOMatorEntraTests` and `ShiftOMatorSeedIdempotenceTests` opt out via
  `ApiTestFactory.DatabaseName` because each one's subject is a property of a *whole table*
  — the exact roster size `ReferenceEndpointsTests` asserts, which any other test writing a
  person or an email would silently invalidate. Those four need **dropping by hand** when
  the schema moves. `ShiftOMatorSetupTests` is the exception that drops and recreates
  itself in the test: a `SystemSetup` row surviving between runs would make a rerun see a
  system that thinks it is already set up (ADR-0059). All five `SetupEndpointsTests` cases
  share that **one** database — the class carries no `[Collection]`, so xUnit runs its
  methods sequentially and each gets it untouched. A database per case is what to reach for
  only if they ever run in parallel with each other.
  **Dropping a test database and immediately re-running races**: several collections then
  create it at once and fail on duplicate keys. Run twice, or drop between runs, not during
- **The demo roster is trimmed at seed time**, not in the fixture: `fixture-dataset.json`
  keeps all 76 people because the Phase 8 baseline comparison is only meaningful over the
  full team, while the database gets `DemoPeoplePerUnit` working people per unit plus every
  manager. A unit with no manager gets its first person granted Planner/Approver/Admin —
  otherwise it comes up with nobody able to do anything in it
- **Startup seeds reference data and nothing else** (ADR-0059). Rows with fixed ids —
  event types, presence types, request types — are **topped up per row** on every start,
  so a database seeded before a type existed picks it up; `SeedRolesAsync` runs
  unconditionally beside them, as a topped-up derivation over whatever roster exists (a
  no-op before setup, self-healing after). The seeder used to guard whole blocks with "if
  any row exists, skip", which left upgraded databases without the newer types and —
  because the role step sat after an early return — without any role grants at all, so
  every screen came up read-only with no explanation.
  **The roster and demo plan are not seeded at all any more**: they are what the setup
  wizard writes. `FixtureSeeder.SeedDemoAsync` is called by `SetupService`, never by
  `Program.cs`
- **What a fresh database starts as is a screen, not configuration** (ADR-0059).
  `SystemSetup` is one row with a fixed primary key, and its presence is the whole of "this
  system has content" — not an inferred condition like "no planning units exist", which a
  half-written database would satisfy and reopen the wizard on top of itself.
  `SetupGateMiddleware` sits **before** authentication and answers `503 SETUP_REQUIRED` to
  everything but `/health/*`, `/api/setup/*`, `/openapi` and `/scalar` (the last two
  because `npm run api:schema` fetches the document against a database nobody has set up).
  Two presets: **Bare** (one location, one unit, the caller from their own token claims,
  a global Admin grant) and **Demo** (the fixture entire). The wizard also asks **which
  roles** the founding administrator gets — `Admin` is forced, because a system whose only
  account cannot reach Settings has no way back, and `Planner`/`Approver` are offered
  because no role implies another (ADR-0051) and a founder who cannot open a draft reads
  as broken. It shows **who you are as the server sees you** before you commit to a
  preset — identity, server auth mode, grants, and a warning when the client's
  `VITE_AUTH_MODE` and the server's `Auth:Mode` disagree, which nothing else checks — and
  closes on **what the system still lacks**, because Bare deliberately leaves no shifts,
  no day configurations and nobody who is planned (`GET /api/setup/diagnostics`). Settings → Maintenance carries
  the two operations afterwards. **`Seed:IncludeDemoData`, `--seed-demo` and
  `Auth:BootstrapAdminEmail` are deleted** — do not reintroduce a config key that decides
  content
- **Reset means migrated-and-empty, never dropped.** `SetupService.ResetAsync` deletes rows
  in dependency order inside one transaction. It cannot be a `DROP DATABASE`: the app holds
  the connection it would have to drop, a second replica holds another, recreating it would
  mean running migrations from inside a request, and it would need the app's managed
  identity to hold rights nothing else it does needs. The delete order is hand-maintained
  and the reset→demo→reset test is what keeps it honest. **`--reset-db` is the other thing**
  — argv-only, for a regenerated `InitialCreate`, and absent from the UI
- **AI is optional and explanation-only**, and **the model is a deployment, not a vendor**
  (ADR-0060). `ChatModel.FromConfiguration` is the only place a provider is named:
  `azure-openai` (Azure AI Foundry — `Ai:Endpoint` is the resource URL, `Ai:Model` the
  **deployment** name), `openai` (OpenAI or anything speaking its protocol, `Ai:Endpoint`
  optional), or `none`. Everything above it works against `IChatClient`
  (Microsoft.Extensions.AI). **`azure-openai` needs no
  key** — with `Ai:ApiKey` empty it uses `DefaultAzureCredential`, i.e. `az login` locally
  and workload identity in AKS, the same chain SQL uses; the grant is
  `Cognitive Services OpenAI User`. That is why production carries no secret at all and
  the chart defaults `azureKeyVault.enabled` to `false`.
  **Nothing requires a key, and that is the design, not an oversight.** Under
  `azure-openai` a missing key is normal (identity), so a blank `Ai:Endpoint`/`Ai:Model`
  **throws at startup** — that is what catches a misconfiguration there. Under `openai` a
  key *or* an endpoint counts as configured, because a model runtime on localhost
  (Foundry Local, Ollama) authenticates nobody and demanding a key it will ignore would
  make the honest configuration the broken one; only when **neither** is set does the
  feature report itself unconfigured.
  Unconfigured is a *supported state* — `/api/insights/gap-summary` answers 503
  `AI_NOT_CONFIGURED`, and `/api/insights/candidate-explanation` still returns its computed
  deciding factor. Helm therefore ships `aiProvider: none` rather than `azure-openai` with
  a blank endpoint: crash-looping the API over an optional feature is the worse failure.
  **The sandbox runs the same `azure-openai` shape as production**, so it rehearses the
  auth path and not just the deployment; neither has a Key Vault, and there is no AI
  secret anywhere. Locally it is off until switched on — `deploy/README.md` section 2b
  covers both Foundry Local (free, on-device, keyless) and a cloud deployment.
  Nothing in planning depends on a model being reachable
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
  Overview is a fixed 1/3/7-day window centered on "now"; Schedule offers `week` /
  `month` / `two-months` / `quarter` / `half-year`, the first three editable. **Columns
  stretch to the width available** — `--cell-w` is `(scroller width − name column) ÷
  columns`, floored at 40px — so the week fits exactly and two months keeps its scroll.
  Measured on the **scroller**, not the card: the card keeps its full width while the
  scroller loses a vertical scrollbar's worth, and sizing from the card left every view a
  permanent fifteen pixels too wide. **Schedule's window runs
  forward from the selected day** (two days of lead-in), not snapped to a calendar month —
  picking the 27th used to show the 1st–31st with the interesting part at the far right.
  Arrows step **one day**; `« »` jump a month. Each screen remembers its own slice in
  `useUi` (`overview` / `schedule`) and writes the single active `useUi.range` on
  mount (`enterOverview()` / `enterSchedule()`); every other consumer — data loading,
  `usePlanningView`, coverage — still just reads `range`. There is no arbitrary custom
  range anymore; the day strip and year scrubber only jump the anchor. All the period
  arithmetic lives in `engine/period.ts`. **A screen's first paint must not use
  `useUi.range`**: it is written by a **layout effect** (`enterSchedule`/`enterOverview`)
  that runs *after* the first render, so on that render it still names whichever screen
  you came from. `useRangeSettled` blanks the grid behind a placeholder until
  `useSchedule.range` matches an **independently recomputed** expected range
  (`rangeFor(zoom, anchor)`, not the stale store value) — the bug this exists to catch is
  a one-frame flash of the previous screen's zoom, and comparing against `useUi.range`
  reintroduces it by coincidentally matching two stale values on the very render it has to
  catch.
- **`Person.isIncluded` decides who is *planned*, never who is *drawn*.** Managers are
  `isIncluded = false` and hold no shifts, and coverage and auto-populate go on ignoring
  them — but everyone active gets a grid row, because a row is the only place leave and
  presence can be recorded. Using the one flag for both meant an administrator appeared in
  the list only while you were acting as them.
- **My calendar is the grid's projections in a different shape** (ADR-0055).
  `pages/MyCalendarPage` builds a dataset of **one** person and runs `projectCells`,
  `projectPresence` and `projectRequests` — the same three — then hands a day to
  `CellSelfServiceMenu` in a floating shell. Nothing about what a day means or what needs
  approving is decided twice. It reads its own long window through `['my-calendar']`, so
  every direct write and every request mutation invalidates that key as well.
- **There are exactly two anonymous routes**, and both are anonymous because the caller
  provably cannot have a token yet. The **calendar feed** is one: `Person.CalendarToken` is
  the whole of its authentication, because a subscribing calendar client cannot carry a
  bearer token. Hence 256 bits, `[JsonIgnore]` so `/api/reference` cannot hand out
  everybody's, seed-time replacement of the fixture's guessable `tok-{personId}` on
  **every** start, and a reset button beside the copy button. A wrong token answers 404
  exactly as an unknown route does. **`GET /api/setup/state`** is the other: it has to
  answer before there is a system to sign in to, and it returns `required` and `stubMode`
  and nothing else — a fingerprint of an unconfigured system is not worth handing out
  (ADR-0059). Adding a third needs the same argument.
- **A person's `employeeId` is a unique external key** once set (filtered unique index;
  `null` is unconstrained) — the field an eventual HR import will match people by.
  `AbsenceImportDialog`'s client-side `matchPeople` already tries it first.
- **The client asks the server who it is** (`GET /api/auth/me` → `AuthProvider` →
  `useSchedule.setCurrentUser`). It used to guess — "the first MANAGEMENT person in
  scope" — and that guess disagreed with both `/api/auth/me` and the audit trail. Never
  reintroduce a client-side identity heuristic.
- **The grid is a valid ARIA grid and Tab leaves it.** `role="row"` wrappers use
  `display: contents` so the CSS grid layout is untouched; the picker is reachable by
  Shift+F10 or the Menu key; `aria-activedescendant` on the scroller carries the virtual
  cursor. Tab is deliberately *not* bound to cell movement — it used to be, which made
  the grid a keyboard trap.
- **A draft survives a change of view.** `load()` used to blank `session`/`changes`, so
  switching unit or period made staged cells and the Publish button disappear while the
  draft sat open on the server — visible to everybody else as hatched cells.
  `listMyOpenDrafts` (`GET /api/drafts?mine=true`, filtered server-side because the
  client's copy of "who am I" arrives later) **resumes** one; it never opens one, or
  looking at a unit would mint an empty session in it.
- **`useSchedule` follows the schedule query, it does not snapshot it.** A cache
  subscription re-seeds `published`/`plan` on every successful fetch for the view on
  screen. Without it, anything the *server* wrote on our behalf — which is every approval —
  never reached the grid: approving leave removed the dashed request and drew nothing, and
  the cell stayed empty until a reload. **Invalidating `['schedule']` is the whole
  contract**; do not add a second path.
- **A failed publish shows a dismissible banner, not the error screen.**
  `useSchedule.actionError` exists because writing to `error` put the app into
  `status: 'error'` and blanked the grid — which is exactly what the planner needs to
  look at while the draft is intact.

## Open questions

**All ten are closed** — five by the prototype spec, three by the owner before Phase 9,
and two by the owner during it (absorb the portal; AI at explanation level only). See
`Docs/14-open-questions.md` for the record, so they are not reopened by accident.

Remaining `ASSUMPTION` values in fixtures (chosen, not confirmed, cheap to change):
`agingThresholdDays` = 14, shift-pool absence limits = 1, comp-off search window, shift
colors and hotkeys, `unit-st`'s `primaryLocationId`, and the seeded role grants (every
manager plans, approves and administers their own unit; one global Admin).

## Known gaps

Not bugs — things the design names and has not built. Full list in
`Docs/13-roadmap.md`.

- **Entra ID works end to end, and both halves must be switched together.** Server:
  `Auth:Mode=EntraId` validates against `Auth:Jwt` (`Authority`/`Audience`, from Key
  Vault), resolves the acting person by matching the token's email claim against
  `Person.Email` (ADR-0058). **Roles come from the database only** unless
  `SystemSetup.DirectoryRoles` is switched on (ADR-0062; a **row**, not a setting, since
  ADR-0063 — read per request, so it needs no restart; toggled in the setup wizard and on
  **Settings → Roles**, where it belongs because it changes what that screen *means*; and
  `Auth:DirectoryRoles` in configuration now **throws at startup** rather than being
  ignored). With it on, `roles` app-role
  claims are mapped to **global** grants that *add* to the per-unit ones stored there.
  It is off because Settings → Roles reads the database only: a directory grant shows
  no ticked box on the one screen that answers "who can do what", cannot be revoked
  from the product, and ticking the box mints a second, independent grant. Listing
  other people's app roles would need Microsoft Graph, so the honest default is one
  source. The switch is a **bool, not a choice of three** — a directory grant can only
  be global, so "directory only" is a mode with nobody able to plan a unit. Client: `VITE_AUTH_MODE=entra` turns on
  `EntraGate` (MSAL, redirect flow, `sessionStorage`), which installs a token provider
  into `api/client.ts` via `setAccessTokenProvider` — **injected, never imported**, because
  MSAL lives in `auth/` which sits *above* `api/` in the layering. Nothing checks the two
  `Mode` settings against each other: mismatched, either the token is ignored or none is
  sent. Linking is deliberately manual — an admin types the work email on Settings →
  People; there is no directory sync, and self-linking is refused by design.
  The **setup wizard** breaks the first-run circle (nobody linked → nobody can reach the
  screen that links people): outside stub mode it reads the caller's own email and name
  from their token, and either creates them (Bare) or links them to the fixture's global
  admin (Demo). It runs once, and only a deliberate Settings → Maintenance reset brings it
  back (ADR-0059, replacing `Auth:BootstrapAdminEmail`). In
  stub mode the identity is
  **switchable** — `Auth:StubPersonId`, or `X-Debug-PersonId` per request — so role
  behaviour is testable without a restart. **`Auth:StubRole` must stay empty**: it is a
  role *override*, and it used to default to `"Planner"` in both `Program.cs` and
  `appsettings.json`, so the override was permanently on and the stored grants were never
  read — nobody was ever an Admin or an Approver, Settings never appeared, and no Approve
  button rendered. `X-Debug-Role` still exists for the API tests
  (comma-separated; the literal `Viewer` strips an account to nothing, an absent header
  means "use their real grants"), but the **in-app switcher picks a person only**: a
  global role override is a state the real product cannot produce, so what it tested was a
  configuration nobody could ever be in. Grants are edited on Settings → Roles. Those headers are read only by
  `StubAuthenticationHandler`, which exists only in stub mode; the client's switcher is
  gated on `MeResponse.stubMode`.
- **No external notification delivery, and the manager in front of it is built.**
  Settings → Notifications carries the matrix and the log, and an enabled cell writes
  `Pending` deliveries that nothing picks up — there is no dispatcher and no sender
  (steps 3–5 of ADR-0064). Three things are deliberately still open, and are decisions
  rather than typing: which address a person is mailed at (`Person.Email` is the key an
  Entra sign-in is matched by, so reusing it is a choice), digest versus one mail per
  event, and how `CompDayAging`/`CoverageGap` avoid telling somebody the same thing every
  morning — both are conditions true every day, so they need the dispatcher's schedule
  *and* a de-duplication key before they can emit at all.
- **No admin screen for request types.** They are data with a seeded starting set, so
  adding one is a row — but until the card exists that row goes in the seed or the
  database. Event types have a screen (Settings → Leave types) and presence types have one
  (Settings → Presence); approval routes no longer need one, because routing is the
  `Approver` grant. Most request types are now derivable from those two screens — one per
  approval-needing event type, one per presence kind — which is why the card has not been
  built: the interesting question is whether it should exist at all rather than be
  generated.
- **Coverage is whole-day, so a half-day absence beside a shift is a flagged conflict
  rather than a representable roster.** The fix is half-day *shifts*, which would let
  coverage count halves and make absence-plus-shift forbiddable. It is blocked by integer
  minimums running through the calculator, the validator, the strip, the digest and their
  tests — a phase, not an afternoon (ADR-0052).
- **A trap worth remembering, now defused.** `AbsenceCapacityRule.CountsTypes` used to
  persist enum **ordinals** through `JsonListConverter`, because
  `JsonSerializerDefaults.Web` registers no string-enum converter. Any future enum → string
  list in a JSON column needs a data migration, not just a type change.
- **No rate limiting, no structured logging beyond correlation ids.** `Docs/12` states
  per-endpoint targets that nothing enforces.
- **Holidays import, they do not sync.** `POST /api/admin/holidays/import` reads an
  iCalendar feed (pasted, uploaded, or fetched from a host in
  `Holidays:AllowedCalendarHosts`) and **adds days that are missing, never removing one**.
  A real sync needs a scheduler and an answer to "the feed dropped a day people are already
  rostered off for", and neither exists.
- **The layout is responsive; the *interaction* is not.** Phase 12 gave the app real
  breakpoints — the clock strip collapses to one clock plus a popover, the issue panel
  becomes a drawer, My calendar stacks — so nothing is unreachable on a narrow screen. What
  is still missing is touch: zero touch/pointer handlers, so painting, range selection and
  the scrubber remain mouse-only. A phone can read this product and cannot plan with it.
