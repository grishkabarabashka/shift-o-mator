# ADR-0031. Stubbed-but-real auth scaffold: bearer token, role claims, no region scoping

**Status:** accepted — implements Phase 4; production replaces the stub with Entra ID.
Extended by [ADR-0039](0039-actor-identity-from-the-token.md), which makes the resolved
identity — not a request-body field — authoritative for every write, and adds a
fail-closed check that the principal maps to a real person.

## Context

A real system needs authentication and authorization. The team uses Entra ID and
expects role-based access control (Viewer, Planner, Admin). The MVP had neither —
everyone was trusted implicitly.

The question is: does auth go in now, before the backend ships, or later when
deployment infrastructure is ready?

A stub auth scaffold is a middle path: the code path is real (bearer token validation,
authorization attributes, role checking), but the token source is fake in dev
(anyone can sign in as anyone). Production replaces the stub with Entra ID without
changing the frontend or any business logic. This de-risks both the code path and the
later Entra integration.

Region scoping (read-only access to your region, write access denied elsewhere) is a
common pattern in multi-region systems. The specification explicitly rejects it
(ADR-0020): all users can write everywhere, and the audit trail provides accountability.
The auth scaffold does not enforce regional boundaries.

## Decision

**Implement bearer token auth in the backend. Dev uses a stub provider; production
plugs in Entra ID. Use `[Authorize]` attributes and role claims for gating.**

- `AuthOptions` in `ShiftOMator.Api` configures the auth provider (stub or Entra).
- `StubAuthenticationHandler` issues tokens on `POST /auth/login` (dev only) for
  testing and demo.
- `GET /api/auth/me` returns the current identity: display name, email, role (Viewer,
  Planner, Admin).
- Frontend checks the role before showing UI: the Suggest button is visible only to
  Planners and Admins; the Settings page is visible only to Admins. This is UX gating,
  not security.
- Every Admin-only endpoint carries `[Authorize(Policy = "AdminOnly")]`. The backend
  enforces the gate; frontend gating is a courtesy.
- No `[Authorize(Roles = "AMER")]` or region-scoped gates. Everyone can read and write
  everywhere. Write access is only through drafts and publish, both audited.

## Consequences

- The frontend knows who is signed in and what role they have. It can gate UI (hide
  the Settings button from viewers, disable Suggest for certain users).
- The backend trusts the token issuer and checks the bearer token on every request.
- Dev deployments use the stub and need no Entra setup. Production deployment sets
  environment variables to swap in Entra ID without code changes.
- Every mutation (a person's eligibility update, a publish, a settings change) is
  attributed to the acting user via the bearer token's identity claim.
- There is no region column on the user. Role-based access control (Viewer/Planner
  /Admin) is global. Permission boundaries — if any are added later — live in the
  business logic, not in auth.

## Alternatives considered

- **No auth until deployment.** Leaves the code path untested and risks integration
  failures and late rewrites.
- **Auth with region scoping.** Violates ADR-0020. The specification is explicit that
  everyone can write everywhere.
- **Client-side role checking only.** Insecure; a determined user can grant themselves
  Admin by editing localStorage.
