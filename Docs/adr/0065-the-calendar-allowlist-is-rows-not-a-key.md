# ADR-0065. The holiday-import allowlist is reference-data rows, not a settings key

**Status:** accepted. Sibling to [ADR-0063](0063-runtime-settings-are-rows.md), which
moved `Auth:DirectoryRoles` from configuration to a row and predicted "the *second*
runtime setting is what should pay for" a general key/value settings table. This is that
second setting, and it does not pay for one — see Alternatives.

## Context

`Holidays:AllowedCalendarHosts` in `appsettings` / the Helm ConfigMap named the hosts
`HolidayImportEndpoints` may fetch a calendar feed from. Read only at request time (once
to build the offered-calendars list, once to gate a URL fetch), never at startup — the
same shape ADR-0063 already named: configuration is what must be known before the process
starts, and this is not that. As configuration it cost a redeploy to add a host, and was
invisible on the one screen that names the risk it exists to contain: an admin endpoint
that fetches an arbitrary URL is a request-forgery proxy pointed at whatever the server
can reach, so the allowlist is the feature rather than a formality (see
`HolidayImportEndpoints`'s own remarks).

The shape differs from `DirectoryRoles`, though: that was one boolean on the one
`SystemSetup` row. This is an open set of hostnames — zero, one, or several — which a
single column cannot hold without reintroducing exactly the delimited-string parsing that
made `Holidays:AllowedCalendarHosts` awkward as an appsettings array in the first place.

## Decision

**`AllowedCalendarHost` is its own table, keyed on the host itself**, with ordinary CRUD
(`GET`/`POST`/`DELETE` on `/api/admin/allowed-calendar-hosts`) — the same shape as
`Location` or `Holiday`, not a column and not a generic settings table.

**1. The host is the primary key.** There is nothing else to store per row: "is this host
allowed" is a yes, and a row's presence is the yes. No surrogate id, no `IsActive` —
removing a host is `DELETE`, the same as retiring a location, because there is no absence
elsewhere that would be left naming a deleted id (unlike `EventType`, which absences point
at and therefore only ever deactivates).

**2. Seeded once, not topped up.** Every other piece of reference data seeded by
`FixtureSeeder` (event types, presence types, request types) is topped up unconditionally
on every start, because an administrator has no way to permanently remove one — `IsActive`
is the only retirement they get, and the row must exist for that flag to sit on. An
allowed host has a real `DELETE`, so topping it up on every restart would silently
resurrect a host an administrator removed on purpose. `SeedAllowedCalendarHostsAsync`
therefore runs only when the table is empty — the one-time seed a fresh `Location` table
would get if the fixture shipped a default.

**3. Global Admin only, same as `DirectoryRoles`.** A host allowed here is reachable by
every unit's import, and there is no unit to scope it to — the server making the request
does not belong to a planning unit.

**4. UI lives on Settings → Maintenance**, beside Load demo data and Reset, not on the
Holidays tab where the import itself lives. Maintenance is already the home for global,
system-wide controls that are not day-to-day editing; the Holidays tab is where an admin
adds a day, not where they decide which external hosts the server may call.

## Consequences

- Adding or removing an allowed host takes effect on the next request, no redeploy.
- `InitialCreate` was regenerated for the new table (CLAUDE.md: there is no production
  data yet, so this stays normal practice) — `--reset-db` locally, test databases dropped
  by hand.
- `Holidays:AllowedCalendarHosts` is deleted from both `appsettings.json` and
  `appsettings.Production.json`. `deploy/README.md` and the Helm chart never carried it as
  a separate value, so nothing there changes.
- The seed carries exactly the host the product has always shipped against
  (`calendar.google.com`), once. A database that already existed before this ADR gets it
  on its next start, same as a fresh one; a database that starts fresh from `--reset-db`
  gets it identically.

## Alternatives

- **A general `AppSetting { Key, Value }` table**, which ADR-0063 flagged as the outcome
  once a second runtime setting showed up. Rejected for this one: the allowlist is a
  *set*, not a scalar, and a key/value row holding a delimited or JSON-encoded list
  reintroduces the parsing ADR-0063 was written to get away from, while gaining nothing
  over a dedicated table with the host as its key. The generic table is still the right
  answer for the *next* setting that is genuinely one value — this is not that setting.
- **A column on `SystemSetup` holding a JSON array**, matching how `PlanningUnit` already
  stores `LocationIds`. Rejected because it puts an open-ended, admin-editable set on the
  one row that is supposed to answer "has this system been set up", and because CRUD
  (add one host, remove one host) is a worse fit for a list column than for rows with
  their own endpoint — every other add/remove-one-item screen in Settings is a table, not
  a list editor on a single field.
