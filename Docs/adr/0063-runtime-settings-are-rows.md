# ADR-0063. A setting that takes effect per request is a row, not configuration

**Status:** accepted. Amends [ADR-0062](0062-one-source-of-roles-by-default.md), which
introduced `Auth:DirectoryRoles` as configuration a day earlier. Extends
[ADR-0059](0059-setup-is-a-screen-not-a-flag.md): the wizard already owns starting
*content*, and this puts the one access setting it can honestly own beside it.

## Context

ADR-0062 put the directory-roles switch in `appsettings` / the Helm ConfigMap. That was
the wrong home, and the reason is a line ADR-0059 already drew: **configuration is what
must be known before the process starts; everything else is data.**

`Auth:DirectoryRoles` is not needed at startup. `RoleClaimsTransformation` reads it on
every request, on a scope it already opens to load the caller's grants. As configuration
it cost a redeploy to change, could not be shown next to the roles it affects, and was
invisible on Settings → Roles — the screen whose whole job is to say what a person holds.
So the switch that decides whether a second source of roles exists lived somewhere the
role screen could not mention.

The distinction matters because the rest of the auth configuration genuinely *is*
configuration and cannot move:

| Setting | Where it must live | Why |
|---|---|---|
| `Auth:Mode` | configuration | `Program.cs` registers either the stub scheme or `AddJwtBearer` at startup; a row cannot re-register middleware |
| `Auth:Jwt:Authority` / `Audience` | configuration | read by `AddJwtBearer` at startup |
| `VITE_AUTH_MODE`, client id, tenant | the web **build** | `import.meta.env` is inlined into the bundle; the server cannot change them at all |
| directory roles on/off | **a row** | read per request, affects nothing that is wired at startup |

There is also a circularity worth recording, because it is what makes "configure
authentication in the wizard" impossible rather than merely unbuilt: outside Stub mode you
must already be signed in to reach the wizard. A wizard that configured sign-in would be
configuring the thing you needed in order to arrive.

## Decision

**`SystemSetup.DirectoryRoles` replaces `Auth:DirectoryRoles`.**

**1. It is a column on the one row that already exists.** `SystemSetup` has a fixed
primary key and exactly one row (ADR-0059). One boolean does not earn a key/value settings
table, nor the "what is a valid key" question that comes with one. The *second* runtime
setting is what should pay for that table.

**2. `RoleClaimsTransformation` reads it per request**, on the scope it already opens. The
toggle therefore takes effect on the next request — the same property that makes database
grants feel immediate, and the reason they were put in the database in the first place
(ADR-0051).

**3. The old key is refused, not ignored.** `Program.cs` throws at startup if
`Auth:DirectoryRoles` is present in configuration, naming this ADR. A settings key that
silently does nothing is precisely how `Auth:StubRole` made everybody a Planner and nobody
an Admin, undetected; one `if` buys immunity to the repeat.

**4. What the wizard can and cannot own.** It owns this switch and the initial role grants,
because both are rows. It does **not** own `Auth:Mode`, the JWT settings or the client
build — the most it can honestly do for those is *show* them and warn when the server's
mode and the client's disagree, which nothing checks today.

## Consequences

- Turning directory roles on or off is a toggle, visible beside the grants it affects, with
  no redeploy and no restart.
- `InitialCreate` was regenerated for the new column, which **invalidates every existing
  database**: `--reset-db` locally, and the test databases need dropping by hand
  (CLAUDE.md). There is no production data, so this is still the project's normal practice
  — the day that stops being true, this is the ADR that has to be revisited first.
- One more read per request. It is a single-column projection over a one-row table on a
  scope that is already open, next to two queries that were already there.
- `deploy/README.md` and `values.yaml` lose a knob. Deployments do not configure this any
  more; the system does.

## Alternatives

- **Leave it in configuration.** What ADR-0062 shipped. Rejected once the wizard question
  was asked: a switch that decides whether a second source of roles exists, which the role
  screen cannot show and an administrator cannot reach, is the same defect ADR-0062 was
  written to remove — just one level up.
- **A general `AppSetting` key/value table.** Where this goes on the second setting.
  Rejected now as the wrong first step: it invites a schemaless bucket, and one boolean
  does not need one.
- **Cache it at startup and reload on change.** Saves a trivial query and buys a cache
  invalidation problem, in exchange for making the toggle take effect at some
  unspecified later moment. The per-request read is the whole point.
