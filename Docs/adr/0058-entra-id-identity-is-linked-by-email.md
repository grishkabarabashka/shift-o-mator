# ADR-0058. An Entra ID sign-in is linked to a person by email, by hand

**Status:** accepted. Narrows [ADR-0039](0039-actor-identity-from-the-token.md) (which
claim the actor is resolved from) and adds a second, global-only source of grants to
[ADR-0051](0051-roles-are-a-scoped-set.md).

## Context

`Auth:Mode=EntraId` has been a config branch with nothing behind it: `Program.cs` bound an
`Auth:Jwt` section that did not exist, and `ActorResolver` resolved the acting person from
a `personId` claim. That claim is only ever issued by `StubAuthenticationHandler` — no
identity provider sets it, and none could, because person ids are ours. So the first real
token to arrive would have authenticated successfully and then mapped to nobody.

Something has to connect a directory account to a `Person` row. The options were an
automatic directory sync, a match on the immutable `oid` claim, or a match on something a
human can read.

## Decision

**An admin links a person to their sign-in by typing their work email into
`Person.Email`, on the Settings → People screen that already edits `EmployeeId`.**

- `Person.Email` is nullable with a filtered unique index — the same shape, and for the
  same reason, as `Person.EmployeeId` (`ScheduleDbContext`). Null means "this person
  cannot sign in yet", which is the correct state for most of a roster that exists for
  planning purposes before anybody has logged in.
- Stored and compared lowercased. SQL Server's default collation is case-insensitive
  anyway; normalising on both sides means a provider whose collation is not, or a token
  that cases the address differently, cannot silently stop matching.
- Outside Stub mode `ActorResolver` resolves **only** by email, and there is no fallback:
  an account matching nobody gets `403 PRINCIPAL_NOT_MAPPED`. The two resolution paths do
  not fall through to one another — trusting a `personId` claim from a real token would be
  trusting a claim the IdP never sets.
- Entra ID **app roles** are read from the `roles` claim and **added to** the grants
  stored in the database. They can only ever be global grants (`unitId: null`), because
  the directory has no planning unit to scope them to. Anything in that claim that is not
  one of our four `AppRole` values is ignored — a directory assigns roles for other apps
  to the same account, and that is not this app's business.
- **Signing in successfully while holding no role at all leaves you a Viewer.** This is
  not new behaviour; it is what `RoleClaimsTransformation` already does for anyone with no
  grants, and it is the right answer: you can read the rota, and nothing else.

## Why email, and not the alternatives

**Not `oid`.** It is the technically better key — immutable, unambiguous, survives a
rename. It is also a GUID, which means an admin cannot type it from memory, cannot
recognise it in a list, and cannot verify they linked the right person by looking. Every
link would begin with a trip to the Entra portal. The trade is real: an email that changes
breaks the link. But it breaks it *loudly* — the person gets a 403 naming the address that
matched nobody, and an admin fixes it by editing one field. That is a better failure than
a key nobody can read.

**Not a directory sync.** It needs Graph permissions, a scheduler, and an answer to "the
directory says this person left, do we deactivate them" — the same shape of question that
[ADR-0047](0047-absorb-the-self-service-portal.md) declined for leave balances and that
the holiday import declined for calendar feeds. The roster is ~80 people and changes
rarely. A field on a screen is the proportionate mechanism.

**Not roles carried entirely in the token.** ADR-0051's reasoning stands: a planning unit
is this product's own concept and no IdP knows what `unit-emea` is. What the directory
*can* express is "this person administers the whole thing", so that is the only thing it
is allowed to say. Per-unit access stays a database concern, edited on Settings → Roles
and taking effect on the next request rather than the next token refresh.

## Consequences

- One more field on `AdminPersonRequest` and on the People form. `EmployeeId`'s
  duplicate-check pattern is copied exactly, including the mirrored server-side validation
  that turns a unique-index violation into a field error instead of a 500.
- **The schema is regenerated, which invalidates every existing database.** Documented in
  CLAUDE.md as the standing cost of the single-`InitialCreate` approach while there is no
  production data; `--reset-db` is the recovery, and `ShiftOMatorTests` needs dropping by
  hand.
- A person cannot self-service their own linking, by design — that would be an account
  claiming a roster row, which is precisely the forgeable-actor problem ADR-0039 exists to
  prevent. What they *can* do is read their own unmatched address off the 403 and send it
  to an admin, which is why that message names it.

## The client half

`VITE_AUTH_MODE=entra` turns on `auth/EntraGate.tsx` — MSAL, redirect flow (not popup:
managed browsers block popups by default and a blocked popup fails silently), tokens in
`sessionStorage` (not `localStorage`: this runs on shared and hot-desked machines, where a
token outliving the browser session is one the next person inherits).

Three seams worth keeping intact:

- **The token function is injected into `api/client.ts`, never imported by it.**
  `setAccessTokenProvider` mirrors the existing `setDebugIdentity`. Layering runs
  `features → store → api → …` and MSAL lives in `auth/`, above `api/`; importing it there
  would invert that and drag the library into stub builds that never sign anybody in.
- **`acquireApiToken` never triggers interaction.** It runs inside every `apiFetch`, and a
  redirect fired from a background query is a hijacked click that discards whatever the
  person was doing. Silent failure returns `undefined`; the gate handles interaction,
  because it is the one place that knows it started from a button press.
- **The gate sits *outside* `AuthProvider`.** `/api/auth/me` must not be called before
  there is a token to send. Sign-in and identity stay separate concerns: the token is a
  credential, the identity is still the server's answer (ADR-0039).

The scope must be the API's own (`api://<app-id>/access_as_user`), not a Graph scope — a
Graph token carries Graph's audience, the API rejects it, and the failure presents as
"signed in, everything 401".

**The ID token is not used for anything we display.** It arrives because OIDC returns one
and MSAL's account model is built on it — `getActiveAccount()`, and the silent renewal
that `acquireTokenSilent` depends on, are keyed to the account the ID token established.
It stays in the browser, is never sent to the API, and is never decoded by our code.
Display name and grants come from `/api/auth/me`, which is a deliberate choice and not an
oversight: the roster's name for a person is the one that appears on the grid and in the
audit trail, and reading a second name out of the directory would put two answers on
screen. The token proves *who signed in*; the server says *who that is here*.

**The client's mode and the server's `Auth:Mode` are set in different places and nothing
reconciles them.** Mismatched, either the token is ignored or none is sent. A server-told
mode would be better but cannot work: the token has to be on the very first request,
including the one that would have asked what mode we are in.

## Consequences, continued

- **Bootstrapping an empty database is circular**: nobody is linked, so nobody can reach
  Settings → People to link anyone. `Auth:BootstrapAdminEmail` breaks it by attaching one
  configured address to whoever holds the global Admin grant at startup.

  The guard is **"no person has an email at all"**, not "no admin exists" — role grants
  are seeded, so admins always exist; what does not exist is any way to *be* one. Because
  the condition is about the whole table, the setting disarms itself the moment anybody is
  linked: it cannot promote a second person later, and cannot silently restore a grant an
  administrator deliberately removed. That property is what makes it safe to leave in a
  values file rather than something to remember to take out.

  A "claim this account" flow would also close the loop, and is exactly the
  account-claims-a-roster-row shape ADR-0039 refuses. A startup setting is different in
  kind: it is written by whoever deploys the system, not by whoever is signing in.
