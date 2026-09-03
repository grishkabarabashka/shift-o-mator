# ADR-0062. One source of roles by default

**Status:** accepted. Narrows
[ADR-0058](0058-entra-id-identity-is-linked-by-email.md), which had Entra ID app roles
read on every request. Does not change the role model itself (ADR-0051) or how a token is
resolved to a person (ADR-0058, ADR-0039).

## Context

Roles reached a caller from **two** places, and they added up:

- **The database** — `RoleAssignment` rows, edited on Settings → Roles, scoped to a
  planning unit or global.
- **The directory** — Entra ID app roles, arriving as the token's `roles` claim, granted
  **globally** because no identity provider knows what `unit-emea` is.

`/api/auth/me` returned the union, so the header and the grid behaved correctly. The
problem was everywhere else.

**Settings → Roles reads the database only.** A person granted `Admin` through the
directory therefore shows *no ticked box* on the screen whose entire job is to answer "who
can do what here". An administrator can untick every box for that person and change
nothing. Ticking one mints a **second**, independent grant that now has to be revoked in a
different place from the first. And `RoleGrant` carries no source, so even where both are
shown together — the identity menu — a directory Admin and a database Admin are the same
row.

That is not untidiness. The screen that lists permissions was omitting a whole source of
permissions, silently, with no way to revoke from inside the product.

Making them visible was considered first and is what the owner initially asked for. It
runs into a hard limit: **app roles arrive only in the token of the person signing in.**
The server does not know, and cannot know, which app roles *other* people hold without
querying Microsoft Graph — which means an application permission, admin consent, a
credential, and a new external dependency on the request path that lists a screen. So
"visible" would have meant "visible for yourself, and a paragraph of apology for everybody
else".

Meanwhile: nothing was using directory roles. No joiner/mover/leaver automation is wired,
and the seeded grants are database rows.

## Decision

**Directory roles are off, behind `Auth:DirectoryRoles`.**

- **Default `false`.** `RoleClaimsTransformation` does not read the `roles` claim at all.
  The database is the single source, and Settings → Roles therefore tells the whole truth
  — which is the property being bought.
- **`true` restores the previous behaviour** exactly: app roles are read and **added to**
  the stored grants, globally, never replacing them.

The switch is a **boolean and not a choice of three**, deliberately. "Directory only" is
not a state worth being able to express: a directory grant can only ever be global, so a
deployment in that mode has nobody who can plan one unit, and the screen that would fix
that has nothing to write to. The directory can only ever be *additive*, and a config
shape that admits an impossible mode is a config shape that invites somebody to try it.

**It is a switch and not a deletion**, because the reading side is ten lines and wiring
corporate joiner/mover/leaver into app roles is a real thing to want later. Turning it on
is then a deployment decision that comes with its caveat attached, not a code change under
time pressure.

## Consequences

- Settings → Roles is authoritative. What it shows is what a person holds; unticking
  removes it; there is one place to look and one place to revoke.
- A deployment that switches `Auth:DirectoryRoles` on gets the old behaviour **and the old
  problem**: grants that screen cannot show. `AuthOptions.DirectoryRoles` carries that
  warning where somebody about to set it will read it.
- Nobody loses access today. Nothing was granted through app roles, and the seeded and
  hand-made grants are all database rows.
- Onboarding gets shorter by one confusing step — defining app roles on the App
  registration and assigning them on the Enterprise application, two different blades for
  the same app. `deploy/README.md` keeps that material, now marked as needed only with the
  switch on.

## Alternatives

- **Tag every grant with its source and show it.** The first choice, and it is still the
  right shape *if* the listing problem is solved. It needs Microsoft Graph
  (`appRoleAssignedTo`) to enumerate other people's directory roles, which is an
  application permission, admin consent and a new dependency for one screen. Worth
  revisiting the day directory-driven access is actually wanted; not worth it to make a
  feature nobody uses honest.
- **Delete app-role reading outright.** Cleaner code, and rejected only because the option
  is cheap to keep and the corporate JML integration is a plausible future. A switch that
  is off costs one `if`.
- **Record directory roles into the database when a token carrying them arrives.** Would
  make them listable without Graph. Rejected: it is a cache whose invalidation is "somebody
  revoked it in Entra and never signed in again", so the screen would confidently show a
  permission that no longer exists — worse than not showing it.
