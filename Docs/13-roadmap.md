# Roadmap and Phase History

## Current state: Phases 0–14 complete

The first Frontend-only MVP built roadmap stages 1–14 above an in-memory fixture layer.
Phases 0–6 reworked the entire stack to move domain logic to a real backend and align
the frontend to the specification of an earlier corporate implementation. Phases 7–8 were
the model rework (Region deleted, one absolute-time Shift entity). Phase 9 made the
product production-shaped and absorbed the separate self-service portal. Phase 10 made the
grid one grid for everybody. Phase 11 rebuilt the authorization model and split the write
paths: drafts publish the rota, everything else is written directly and reviewed by
approval. Phase 12 gave the UI a design language. Phase 13 made Entra ID sign-in real and
the app deployable to AKS. Phase 14 replaced the seeding flags with a first-run setup
screen.

**Phases completed:**

| Phase | Work | Completion |
|---|---|---|
| 0 | Initial rework planning and repository setup | foundation laid |
| 1 | Merge Dashboard and Timeline into Overview (ADR-0025), update shell navigation | Overview at `/overview`, old routes redirect |
| 2 | .NET backend structure: Domain/Application/Infrastructure/Api layers with seeded fixture data | backend runs with `dotnet run --project api/src/ShiftOMator.Api` (the `--seed-demo` flag it shipped with was replaced by the setup wizard in Phase 14) |
| 3 | Port coverage, validation, comp-day, candidate ranking engines to C# as the single implementation; add DraftService for server-side draft persistence | All domain logic now server-side; validation runs server-side on `POST /api/drafts/{id}/publish` |
| 4 | Add stubbed-but-real auth scaffold: bearer token, role claims, `[Authorize]` attribute on endpoints | identity available via `GET /api/auth/me`, endpoints gated by role |
| 5 | HTTP cutover: HttpScheduleRepository replaces in-memory store, all CRUD over REST; TanStack Query for server state, Zustand only for UI state and draft metadata; OpenAPI type generation | Frontend talks entirely to backend over `/api/*` endpoints; `npm run api:schema:check` validates type generation |
| 6 | Settings page with Admin surface for reference data (ADR-0021) | Settings at `/settings`, full CRUD, all mutations gated by the Admin role |
| 7–8 | Model rework: Region deleted, PlanningUnit becomes the single rule axis, Role and Shift collapse into one absolute-time entity, zero minimums legalised (ADR-0032/0033/0034) | Guarded by a frozen baseline comparison (`Phase8Baseline`) proving non-ST coverage and issues came out byte-identical |
| 9 | **Production readiness and self-service.** Actor identity from the token; one change history for every entity; scoped dataset loading; version tokens on absences and comp days; presence; requests, approvals and an in-app inbox; AI explanations (ADR-0039–0048) | The audit trail ADR-0032 depends on is now real and complete; the separate portal is absorbed |
| 10 | **One grid, configurable absences, half-days.** Event types as data; `portion` on absences and presence; the cell splits into chip and band; the grid is gated by role and carries self-service; approvers named per unit; a per-cell audit timeline; a switchable stub identity (ADR-0049–0050) | The role-blind grid — a live defect where a viewer's click did nothing and said nothing — is fixed; the schema is one migration again |
| 11 | **Roles, and the two flows.** Roles become a set granted per planning unit, with the ordinal comparison deleted and approval routes replaced by the `Approver` grant; drafts narrow to the rota, absences and presence become direct writes gated by approval; roster markers deleted; an absence fills the cell; comp days are placed by the person taking them (ADR-0051–0052) | An Admin can no longer assign shifts by accident of enum order, and a viewer can record their own sick day |
| 12 | **A design language.** An elevation ladder, a type scale, real breakpoints, the header's own sky, and a toast layer beside the three existing failure surfaces (ADR-0057) | The app has one visual system instead of per-screen decisions; success has a channel it never had |
| 13 | **Entra ID, and a deployable app.** Real JWT validation, identity linked to a person by email, app roles as global grants (switched **off by default** since [ADR-0062](adr/0062-one-source-of-roles-by-default.md)); container images and a Helm chart for AKS (ADR-0058) | A real token signs a real person in; `helm upgrade` is the deployment |
| 14 | **First-run setup.** `SystemSetup` is the flag, a middleware gate refuses everything until it exists, and a wizard writes either a Bare system or the Demo fixture; Settings → Maintenance carries load-demo and reset afterwards (ADR-0059) | What a database starts as is a decision the product asks for, not a config key set before it runs — and it can be changed afterwards |

Phase 14 in detail, since it deleted configuration other environments may still set:
a system with no `SystemSetup` row answers `503 SETUP_REQUIRED` everywhere except
`/health/*`, `/api/setup/*` and the OpenAPI document, and the browser shows a wizard: pick
**Bare** (one location, one unit, you as the global Admin, taken from your token) or
**Demo** (the fixture entire). Afterwards Settings → Maintenance carries the same two
operations — **Load demo data**, guarded on the system still being untouched, and **Reset
to empty**, which deletes rows in dependency order and hands the wizard back.
`Seed:IncludeDemoData`, `--seed-demo` and `Auth:BootstrapAdminEmail` are deleted;
`--reset-db` stays as the development recovery for a regenerated `InitialCreate`.


**Since Phase 14, two decisions landed that belong to no phase of their own:**

- **The model is a deployment, not a vendor**
  ([ADR-0060](adr/0060-the-model-is-a-deployment-not-a-vendor.md)).
  `ChatModel.FromConfiguration` is the only place a provider is named — `azure-openai`,
  `openai`, or `none` — and everything above it works against `IChatClient`. Under
  `azure-openai` no key is needed: `DefaultAzureCredential` means `az login` locally and
  workload identity in AKS, the same chain SQL uses, which is why production carries no AI
  secret and the chart defaults `azureKeyVault.enabled` to `false`. The sandbox runs the
  same shape as production so it rehearses the auth path and not just the deployment.
- **Settings saves people as one unit**
  ([ADR-0061](adr/0061-settings-saves-people-as-one-unit.md)).
  `POST /api/admin/people/batch` applies every pending person edit or none, releases before
  claims, in one transaction — because `Email` and `EmployeeId` carry unique indexes and
  moving a sign-in address between two people, sent row at a time, ended with the address on
  nobody and somebody locked out of the product. Person edits now write history, which
  ADR-0040 had required all along.

**Remaining, not yet scheduled:**

- **Half coverage — half-day *shifts*, not half-days.** Half-days themselves shipped in
  Phase 10: `portion` (`FULL | MORNING | AFTERNOON`) is on `Absence` and `PresenceRecord`,
  it travels through requests and `RangeSupersede`, and the cell splits to draw it
  ([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)). What is missing is the
  other side: **`CoverageCalculator` has no notion of `portion` at all**, so a person is
  counted whole or not counted. A half-day absence beside a shift is therefore a flagged
  conflict rather than a representable roster — there is no way to say "off this morning,
  working this afternoon" as a rota.

  The fix is shifts that carry halves, so coverage counts halves and the combination can
  then be forbidden outright. ADR-0050 rejected it on the grounds that the boundary hour
  would be invented; that argument is weaker than it looked — the boundary is derivable
  from the shift's own window. What actually blocks it is integer minimums running through
  `CoverageCalculator`, `Validator`, the coverage strip, `IssueDigest` and their tests
  ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

- **Directory sync for the roster — joiner, mover, leaver.** Signing in works: a token is
  validated and resolved to a person by matching its email claim against `Person.Email`
  ([ADR-0058](adr/0058-entra-id-identity-is-linked-by-email.md)). **Linking is manual** —
  an admin types the work address on Settings → People, and self-linking is refused by
  design. What does not exist is any traffic in the other direction, from Microsoft Graph
  into the roster:

  - a new hire does not appear as a `Person`; somebody adds the row;
  - a transfer does not move `unitId`, `locationId` or `managerId`;
  - **a leaver stays active.** Their Entra account is disabled and they can no longer sign
    in, but the roster row goes on being planned, counted in coverage and offered as a
    candidate until somebody deactivates it by hand.

  The last one is the reason this is a real gap rather than a convenience: the product has
  no way to learn that somebody left. Building it needs a Graph application permission,
  admin consent, a credential, a scheduler, and an answer to "the directory says this person
  left, and they are rostered for next Tuesday" — which is a policy question, not a sync
  question. For ~80 people, typing is tractable in the meantime.

- **Stub mode** is the local loop, and is not a gap — it is how role behaviour is tested
  without an IdP. The identity is **switchable**: `Auth:StubPersonId` pins one, and the
  `X-Debug-PersonId` / `X-Debug-Role` headers override per request. `X-Debug-Role` is
  comma-separated, because roles are a set; the literal `Viewer` strips an account to
  nothing, and an absent header means "use their real grants". The in-app switcher uses
  only the person header — grants belong on Settings → Roles, and a global override was a
  state the product cannot produce, so what it tested was a configuration nobody could ever
  be in. Both headers are read only by `StubAuthenticationHandler`, which exists only in
  stub mode.

- **External notification delivery** — the outbox columns exist and are unused; Phase B is
  one in-process dispatcher sending via Graph ([ADR-0044](adr/0044-in-app-inbox-first.md)).
- **An admin screen for request types.** Event types have one (Settings → Leave types) and
  so do presence types (Settings → Presence); request types do not, so adding one still
  means a row in the seed or the database. Most are now derivable from those two screens —
  one per approval-needing event type, one per presence kind — which is why the card has
  not been built: the open question is whether it should exist at all rather than be
  generated. Approval routes need no screen: who approves is the `Approver` grant, edited
  on Settings → Roles.
- **Admin CRUD writes no history.** ADR-0040 says every entity, and person edits got there
  with [ADR-0061](adr/0061-settings-saves-people-as-one-unit.md) — but locations, units,
  shifts, day configurations, holidays and absence capacity rules still write no
  `ChangeHistoryEntry` at all. "Who raised this minimum, and when" has no answer, which is
  exactly the question effective dating exists to make askable.
- **No batch save outside people.** The criterion is stated in ADR-0061: an entity needs a
  batch when its rows can invalidate each other. Nothing else currently can, so nothing else
  has one; a generic `POST /api/admin/changes` is where this goes if a second entity ever
  does.
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
