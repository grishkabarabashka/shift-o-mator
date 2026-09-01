# ADR-0059. Setup is a screen, not a flag

**Status:** accepted. Replaces the bootstrap mechanism in
[ADR-0058](0058-entra-id-identity-is-linked-by-email.md) (`Auth:BootstrapAdminEmail`) and
retires the `Seed:IncludeDemoData` / `--seed-demo` pair. Does not change how an actor is
resolved (ADR-0039) or how grants are scoped (ADR-0051).

## Context

What a fresh database starts as is currently decided in three different places, none of
them the product:

- `--seed-demo`, an argv flag — which means overriding the container's command, because
  argv is baked into the image's entrypoint.
- `Seed:IncludeDemoData`, the same decision as configuration, reachable from compose and
  from the Helm ConfigMap. This one works; it is also the *only* one of the three that
  does.
- `Auth:BootstrapAdminEmail`, which links one configured address to whoever already holds
  a global Admin grant — and therefore needs a redeploy to change, and attaches the
  operator's identity to an arbitrary person out of the fixture.

Worse, the demo flag does not do what its name says. `FixtureSeeder.SeedAsync` guards the
fixture block on `!db.PlanningUnits.AnyAsync()` and seeds locations, holidays, units **and
the roster** inside it regardless of the flag; only assignments, absences and comp days sit
behind `includeDemoData`. So a first production run comes up with seventy-six invented
people, four invented units and no shifts — a state nobody chose and no configuration can
express. There is no "empty" at all.

The thing all three have in common is that they are answered before the system is running,
by whoever runs `helm upgrade`, and cannot be answered again afterwards.

## Decision

**A database that has not been set up serves one screen, and that screen writes the
starting state.** Configuration decides nothing about content.

**1. `SystemSetup` is the flag.** One row, fixed primary key:
`{Id = 1, CompletedAt, CompletedByPersonId, Preset}`. Its presence is the whole of "this
system has been set up". Not an inferred condition like "no planning units exist" — a
partially written database would then reopen the wizard and offer to write over itself,
and the fixed key makes a concurrent second call fail on a duplicate rather than run twice.

**2. A middleware gate, not a check per endpoint.** With no `SystemSetup` row, everything
except `/health/*` and `/api/setup/*` answers `503 SETUP_REQUIRED`. Placed in the pipeline
because the failure mode of the alternative is a forgotten endpoint that accepts writes
into an unconfigured system, and that is exactly the kind of omission nobody notices.

**3. The migration creates schema; the wizard creates content.** The one exception stays
what it already is: reference data with fixed ids — event types, presence types, request
types — is topped up at startup on every run. That is code, not a choice. A leave type the
product ships is part of the product; an admin picks *which* of them are offered, not
whether the row exists.

**4. Two presets.**

| Preset | Writes |
|---|---|
| **Bare** | one location (name, timezone, weekend calendar), one planning unit (name, kind), the acting person, a global Admin grant |
| **Demo** | the fixture entire: locations, holidays, four units, the trimmed roster, shifts, day configurations, absence-capacity rules, and the demo plan |

There is no third "structure without people" preset. It reads like the useful middle and
is not: units and shifts are five minutes of typing on Settings, while a half-fixture is a
second code path through the seeder that has to be kept correct forever.

**5. The first admin comes from the token, not from a form.** In `EntraId` mode the wizard
reads display name and email out of the claims of whoever is running it and creates that
`Person`. Nothing is typed, because the one thing a typo in this field produces is a
system whose only administrator cannot sign in. In `Stub` mode there are no claims to
read, so the wizard asks — that is the development path, and the recovery there is
`--reset-db`.

**6. Settings → Maintenance carries the two operations the flags used to.** Both are
Admin-only and both write `ChangeHistoryEntry` (ADR-0040):

- **Load demo data**, offered only while the system holds no assignment, absence or comp
  day and no hand-created person. The fixture has fixed ids; merging it into a database
  somebody has edited produces collisions and a roster nobody can reason about. When it is
  unavailable the button is shown disabled with the reason, not hidden — a missing control
  is indistinguishable from a bug.
- **Reset to empty**, confirmed by typing the environment name rather than by pressing
  "Yes". It deletes rows in dependency order inside one transaction and removes the
  `SystemSetup` row, so the next visit is the wizard again.

**7. Removed:** `Seed:IncludeDemoData`, `--seed-demo`, `Auth:BootstrapAdminEmail`, and
their `values.yaml` counterparts. `--reset-db` stays, argv-only and absent from the UI: it
exists for the case where `InitialCreate` itself was regenerated, which is a development
event.

## Why the first visitor is trusted

The gate is open to whoever reaches it first, and that is deliberate. The alternative
considered was the Jenkins pattern — a token printed to the pod's log, proving the caller
can read the cluster.

It was rejected because the threat it defends against is not this product's: nobody is
waiting on the deployment to race the owner to a URL, the window between first boot and
setup is minutes, and the recovery — reset and set up again — is a button that now exists.
A token would buy a marginal reduction in an already small risk and charge for it on every
single legitimate first run, including every developer's.

Two things bound the residual risk without a token. In `EntraId` mode the caller still has
to hold a valid token from the tenant, so "whoever is first" means an employee, not the
internet; and setup is recorded — `CompletedByPersonId` and `CompletedAt` say who did it
and when. If this system is ever deployed somewhere its first boot is publicly reachable,
this decision needs revisiting, and that is the trigger to write down.

## Why reset deletes rows and does not drop the database

"Return to the initial state" means *migrated and empty*, not *absent*. Three reasons it
cannot be a drop:

- The application is holding the connection it would have to drop, and at
  `replicaCount.api: 2` a second process is holding another.
- Recreating it means running migrations from inside a request, which is the one thing the
  startup path has just been relieved of.
- It would require the app's managed identity to hold rights to drop a database. Nothing
  else it does needs that, and granting it so that one button works is the wrong trade.

The cost is that the delete order is hand-maintained and has to follow the foreign keys.
That is a test, not a design problem: reset, then seed the demo preset, then reset again —
if the order is wrong the first run fails loudly rather than leaving orphans.

## Why the admin is created and not linked

ADR-0058 refused to invent a `Person` and linked an email to an existing one instead, on
the grounds that a created row is a roster entry nobody asked for that coverage then has to
be taught to ignore. That argument was about a database that already has a roster. On an
empty one there is nobody to link to, and the person running setup is a real member of the
team whose row has to exist eventually anyway.

`Person.UnitId` and `Person.LocationId` are `required` and non-nullable, which is why the
Bare preset asks for a location and a unit before it can write anybody at all. That is not
incidental scope — it is the minimum a person can exist inside, and it is the reason "seed
nothing" is not one of the presets.

## Consequences

- One more table, so the schema is regenerated and every existing database is invalidated
  again — the standing cost of the single-`InitialCreate` approach (CLAUDE.md). The three
  test databases need dropping by hand.
- `/api/setup/*` are the only endpoints in the system that write while the caller holds no
  grant. They are therefore the only ones whose guard is the `SystemSetup` row itself: once
  it exists they answer `409 SETUP_COMPLETE` unconditionally, before looking at anything
  else in the request.
- The client needs a state before `AuthProvider` has an answer: `GET /api/setup/state` is
  anonymous and returns `{ required }`. It joins the calendar feed as an unauthenticated
  route, and like it, it is deliberately uninformative — `required` and nothing else, since
  a fingerprint of an unconfigured system is not worth handing out.
- `deploy/README.md` and `compose.yaml` lose their seeding instructions and gain one
  sentence: bring it up and open it.
- Demo data becomes reachable *after* the fact, which it never was. Loading a demo plan
  into a sandbox stops being a redeploy.

## Alternatives

**Keep the configuration flags and fix only the roster bug.** Cheapest, and leaves the
decision where it cannot be revisited: the operator still answers, once, in a values file,
and still cannot change their mind without a redeploy.

**A Helm pre-install Job that seeds.** Correct for a system whose starting content is
decided by whoever deploys it. It is not this one — the owner is choosing between demo and
real, and that is a product question, not a deployment one.

**A setup token in the pod log.** See above; rejected as disproportionate.
