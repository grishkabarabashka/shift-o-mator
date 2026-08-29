# ADR-0044. An in-app inbox first; the same table becomes an outbox later

**Status:** accepted

## Context

The product had **no notification mechanism of any kind** — no email, no Teams, no
webhooks, no background jobs — while promising things that need one:

- ADR-0007 and `Docs/05-comp-days.md`: an aged comp day produces *"a manager alert plus a
  standing notice for the person."* Neither was ever delivered anywhere. The aging flag is
  computed and rendered, and that is all.
- `Docs/11-integrations.md`: the absence import's impact analysis surfaces published
  assignments that overlap incoming leave — visible only to whoever happens to be running
  the import.

Self-service (ADR-0045) makes this load-bearing rather than merely unkept. An approval
queue nobody is told about is a worse process than the Teams message it replaces: at least
a message pings someone.

The obvious answers all cost infrastructure this deployment does not have. There is no
worker process, no queue, no scheduler, and adding one for a handful of approvals a day is
infrastructure for its own sake.

## Decision

**Phase A — one table, written inside the same transaction as the change that caused it.**

```
Notification {
  id, recipientPersonId
  kind        REQUEST_SUBMITTED | REQUEST_APPROVED | REQUEST_REJECTED
            | REQUEST_APPLY_FAILED | COMP_DAY_AGING | COVERAGE_GAP
  title, body?
  subjectType?, subjectId?      so the client can deep-link
  createdAt, readAt?
  channel?, deliveredAt?, deliveryAttempts    -- Phase B, unused for now
}
```

`Requests/Notifier` only ever calls `Add`; the rows are saved by the caller's
`SaveChangesAsync`. That *is* the design — a notification cannot be lost to a crash
between the state change and the send, because there is no send. It also cannot exist for
a change that rolled back.

The client polls (`useNotifications`, 60s) and shows a bell in the shell. No realtime
channel, because there is nothing here that a minute of latency harms.

**Phase B — the same table becomes a transactional outbox.** `channel`, `deliveredAt` and
`deliveryAttempts` are already present, so external delivery is a dispatcher, not a
migration and a backfill. One in-process `BackgroundService` polling every 60s, sending via
Microsoft Graph using the same Entra app registration the auth swap needs.

## Consequences

- Recipients are de-duplicated on write. An approval route can resolve the same person
  twice — named on a step and also the fallback — and two identical bells is a bug, not
  thoroughness.
- A failed *application* of an approved request notifies **both** the subject and the
  approver, because neither can infer it from the other's screen (ADR-0045).
- The columns for Phase B ship unused. That is deliberate: they cost nothing now and
  remove a migration from the path later.
- **A known SPOF, stated rather than designed around:** the Phase B dispatcher is a single
  in-process instance. If the API is ever scaled out it needs a lease row. At this scale,
  run one instance and say so.
- The comp-day aging alert and the import impact list now have somewhere to go. Wiring
  them is a call to `Notify`, not a feature.

## Alternatives considered

- **Email or Teams directly from the request handler.** Puts a network call to an external
  service inside the transaction that approves leave: either the transaction waits on
  Graph, or a crash between commit and send loses the notification silently. Both are
  worse than a row.
- **A message queue.** The correct answer at a scale this is not. It adds a broker to
  deploy, monitor and back up, for a workload of a few messages a day.
- **SignalR / WebSockets for realtime.** Solves latency nobody is complaining about, and
  the bell would still need a table behind it for anyone who was offline when it fired.
- **No inbox; rely on people opening the Requests screen.** This is the status quo with
  extra steps, and the failure mode — a queue nobody looks at — is the one thing
  self-service cannot survive.
