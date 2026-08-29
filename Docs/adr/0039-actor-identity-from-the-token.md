# ADR-0039. Actor identity comes from the token, never the request body

**Status:** accepted

## Context

ADR-0032 removed unit-scoped write permissions from the model entirely, on an explicit
argument: the team is small, nobody edits another team's rota without reason, and *"the
control is a **complete audit trail** — who changed what, when, and what it was before —
not a permission matrix."*

The audit trail was not a control. It was a field the caller filled in.

- `POST /api/drafts` took `editorPersonId` from the request body, and
  `DraftsEndpoints.PublishAsync` used `session.EditorPersonId` as the actor for every
  history row the publish wrote.
- `POST /api/acknowledgements` took `byPersonId` from the body — the acknowledger's name
  is the entire value of an acknowledgement record.
- `POST /api/auto-populate` took `ActorId` from the body, and stamped it onto every
  generated assignment's `CreatedBy`.

Any caller who passed the policy check could attribute their changes to anyone. The one
guarantee the access model rests on was forgeable by whoever it was meant to constrain.

Worse, nobody was attributing changes to a real person anyway. `StubAuthenticationHandler`
issues a fixed `p-planner`, who is deliberately **not in the seeded roster**; the client
papered over that by guessing its own identity in `useSchedule.load()` — *"the first
MANAGEMENT person in scope, else anyone"* — and sending that guess. So `createdBy`,
`updatedBy` and every history row named whichever person happened to sort first, and
`GET /api/auth/me` reported a different identity again.

## Decision

**The acting person is resolved from the authenticated principal, and the DTOs no longer
carry one.** `EditorPersonId`, `ByPersonId` and `ActorId` are removed from
`OpenDraftRequest`, `AcknowledgeRequest` and `AutoPopulateRequest`.

Resolution goes through one scoped service, `Auth/ActorResolver`, because a claim is not
enough on its own — an id that names no real person produces history rows that cannot be
read back:

1. Take `personId` (or `NameIdentifier`) from the principal.
2. Check it against the roster. If it names a real `Person`, that is the actor.
3. Otherwise, **in `Auth:Mode=Stub` only**, fall back to one real, deterministic person
   (the first active manager by id) and log a warning naming the substitution.
4. Outside stub mode, refuse: `UnmappedPrincipalException` → `403 PRINCIPAL_NOT_MAPPED`.

`GET /api/auth/me` resolves the same way, so "who am I" and "who will the audit trail say
I am" cannot disagree. The client drops its guess entirely and reads the answer from the
server (`AuthProvider` → `useSchedule.setCurrentUser`).

## Consequences

- Every history row, `createdBy`/`updatedBy`, and acknowledgement now names the caller.
  With stub auth that is a substituted-but-real person; with a real IdP it is the person
  who was actually signed in, and no endpoint changes at the swap.
- The client's `openDraft(unitId, range, editorId)` keeps its `editorId` parameter but no
  longer sends it — it is still used locally to filter *other people's* overlapping
  drafts. The authoritative editor comes back on the created session.
- `startDraft()` no longer waits to know who the current user is. It used to refuse to
  open a draft until `currentUserId` was resolved, which meant an edit made while
  `/api/auth/me` was still in flight silently did nothing.
- The stub fallback is deliberately loud. Silently acting as a phantom is what produced
  this situation; a warning per session naming the substitution is the cost of keeping
  local development working without an IdP.
- Fails closed in production. An authenticated principal the app cannot map to a person
  is refused rather than substituted, because outside development a mismatch means the
  identity mapping is wrong, not that a convenience is missing.

## Alternatives considered

- **Validate that the body's actor matches the token.** Same effect for honest callers,
  more code, and it leaves a field in the contract whose only correct value is one the
  server already knows. Removing it is the smaller API.
- **Seed `p-planner` as a real person.** Fixes the mapping and nothing else: the body
  would still be authoritative, and the roster would carry a fictional employee that
  every screen has to filter out.
- **Keep the client's "first manager in scope" heuristic and send it.** This is what
  existed. It produced three different answers to one question, none of them checked.
