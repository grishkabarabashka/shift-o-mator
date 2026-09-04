# ADR-0064. What gets sent is a matrix; what was sent is a log

**Status:** accepted. Extends [ADR-0044](0044-in-app-inbox-first.md), which reserved
outbox columns on `Notification` for exactly this moment. Extends
[ADR-0063](0063-runtime-settings-are-rows.md): this is the second runtime setting, and it
is what pays for a table rather than another column on `SystemSetup`.

## Context

ADR-0044 built an in-app inbox and left three columns — `Channel`, `DeliveredAt`,
`DeliveryAttempts` — for the day external delivery arrives. That day is not today: nothing
should leave the building yet. What is needed now is the thing that will decide, when it
does: **who gets told what, through which channel, and where anybody can go to see what
actually happened.**

Four gaps stand between the current code and that:

1. **Only requests emit.** `NotificationKind.CompDayAging` and `CoverageGap` exist and are
   written by nobody. They are computed in `Application`; `Notifier` lives in
   `Api/Requests/`, which `Application` cannot see. Half the events physically cannot use
   the one service meant to be central.
2. **Recipients are resolved inside the handler.** The rule — the `Approver`s of the
   subject's unit, falling through to admins (ADR-0051) — has one correct implementation
   and no home.
3. **There is nowhere to express policy.** "This event goes out, that one does not" has no
   representation except an `if` in a handler — the same shape as the `requiresApproval`
   check that used to sit in the cell menu and let any caller bypass it (ADR-0054).
4. **`replicaCount.api` is 3 in production.** The single in-process dispatcher ADR-0044
   describes was a stated SPOF; at three replicas it is triple delivery instead.

## Decision

**1. Channels are a closed set; kinds are code; the matrix between them is data.**
`NotificationChannel` is `InApp | Email | Teams`. It is closed for the reason `countsAs` is
closed (ADR-0054): each member is a sender that has to be written, so an admin cannot
invent one. `NotificationKind` is likewise an enum. What is data is the cell where they
cross:

```
NotificationRule                 -- id "nr-request-approved-email", unique (kind, channel)
  kind, channel
  enabled          bool
  userOverridable  bool          -- may a person turn this off (phase 5)
```

The pair is the real key and keeps a unique index; the id derived from it exists because
the seeder tops rows up *by id*, and because every DTO, history row and admin endpoint
here addresses a row by a string id. A composite primary key would have bought nothing and
cost a special case in each of those.

Rows are topped up per fixed key on every start, so a kind added in code appears on the
screen by itself — the seeding rule that ADR-0059 already relies on for event, presence
and request types.

**2. In-app is not a row in the matrix.** The `Notification` row *is* the inbox. Giving it
a checkbox would let an administrator switch off the only place an event is visible at all.
The matrix starts at Email.

**3. Delivery is a child table, and the fan-out is decided at write time.**

```
NotificationDelivery
  id, notificationId, channel
  status       Pending | Sent | Failed | Skipped
  skipReason?  ChannelDisabled | NoAddress | UserOptedOut
  attempts, lastError?, sentAt?
```

The three outbox columns on `Notification` are **deleted**: one row per notification can
express one channel, and "email *and* Teams" is the case this exists to serve. There is no
production data, so this is a regenerated `InitialCreate`, not a backfill (which is the
migration ADR-0044 was avoiding when it put the columns there — the avoidance succeeded
right up until the second channel).

`Notify` writes the inbox row and its delivery rows in one transaction, consulting the
matrix as it goes. Not the dispatcher, because:

- the rows record **the policy in force when the event happened**; editing the matrix does
  not retroactively rewrite what was already queued;
- the dispatcher stays a loop that takes `Pending`, sends, and marks — it needs to know
  nothing about rules or preferences;
- with an empty matrix `Notify` writes the inbox and nothing else, which is exactly
  today's behaviour, reached without a special case.

The cost, stated: a rule change does not reach deliveries already queued, a window of up
to one dispatcher interval.

**4. `Skipped` is written, not omitted.** The question the log exists to answer is "why did
this person not get the email", and the answers are: the channel is off, they have no
address, they opted out, or the send failed. Without a `Skipped` row, a missing row means
both "not owed one" and "lost one", and the screen cannot tell them apart.

**5. The log is a read model over rows that already exist.** No third table.
`Notification` and `NotificationDelivery` are append-only and are the history. Two things
follow: `readAt` is the recipient's own state and an administrator reading the log does not
touch it; and notifications do **not** get copied into `ChangeHistoryEntry` (ADR-0040),
which records edits people made to entities — a notification is not an edit, and a second
copy of the same fact is what that ADR forbids.

**6. Rules are global, not per unit.** Per-unit rules multiply the matrix by four and
create four places to silently leave a unit's approvers without mail. Nobody has asked for
different policy per unit; the day someone does, `unitId` is nullable on the rule with null
meaning global, exactly as `RoleAssignment` already reads (ADR-0051).

**7. Order of work, so that nothing can leave the building early.**

| # | Step | Leaves the building |
|---|---|---|
| 1 | `Notifier` leaves `Api/Requests/`; the policy half becomes `Application/Notifications/NotificationFanout` | nothing |
| 2 | `NotificationRule`, `NotificationDelivery`, Settings → Notifications (Rules + Log) | nothing — `Pending` rows accumulate |
| 3 | Dispatcher + Email via Graph `Mail.Send` on the existing workload identity | email |
| 4 | Teams sender | Teams |
| 5 | `NotificationPreference{personId, kind, channel}`, honoured only where `userOverridable` | — |

Step 2 is a working, visible notification manager with no sender behind it: the fan-out can
be watched accumulating before anything is capable of sending it. Steps 1 and 2 are this
ADR; 3–5 need their own decisions on the questions below.

## Consequences

- **The writer is in Infrastructure, not Application, and the plan above said otherwise
  before it was built.** `Application` references `Domain` and nothing else — the
  dependency runs `Infrastructure → Application → Domain` — so an extension on
  `ScheduleDbContext` cannot live there. The split that survives is better than the one
  proposed: `NotificationFanout` is pure and tested in `Application`, and
  `Infrastructure/Notifications/Notifier` holds only the write. What the move was *for*
  still holds — everything above Infrastructure can reach it, which the old home in
  `Api/Requests` could not offer to a comp-day or coverage emitter at all.
- **`CompDayAging` and `CoverageGap` still emit nothing, and that is not an oversight of
  this step.** Both are conditions that are *true every day* rather than events that
  happen once, so writing one needs a periodic trigger and a way of not telling somebody
  the same thing every morning. The trigger arrives with the dispatcher in step 3; the
  de-duplication is its own decision (a natural key on the notification, most likely) and
  is deliberately not invented here. Their kinds and matrix rows exist and are ready.
- **Two questions are deferred to step 3, deliberately.** Which address a person is mailed
  at — `Person.Email` is the key an Entra sign-in is matched by (ADR-0058), and reusing it
  as a mailing address is a decision, not a given. And digest versus one mail per event: at
  a few approvals a day per-event is fine, and the log makes the volume measurable before
  anybody guesses.
- **Three replicas need a claim, not a lease row.** `SELECT ... WITH (UPDLOCK, READPAST)`
  over a batch of `Pending` is cheaper than the lease ADR-0044 anticipated and removes the
  stated SPOF instead of documenting it.
- **Delivery is at-least-once.** `sentAt` is committed in the transaction that observed a
  successful send; a crash between send and commit re-sends. A duplicate mail is a better
  failure than a lost one.
- The log grows without bound and should: ~80 people and a few events a day is tens of
  thousands of rows a year. Indexes on `(CreatedAt desc)` and `(RecipientPersonId, ReadAt)`,
  no retention policy.
- `Retry` on a `Failed` row sets it back to `Pending` without resetting `attempts` — the
  count is evidence, and zeroing it hides a channel that fails every time.

## Alternatives considered

- **Fan out in the dispatcher.** Fewer rows, and the matrix would apply to everything
  pending at send time. Rejected because the log then cannot say what the policy was when
  the event happened, and because `Skipped` would have nowhere to be written for a channel
  that was never considered.
- **An open `NotificationChannel` table.** Symmetrical with `PresenceType` (ADR-0054), and
  wrong for the same reason it was right there: a presence type needs no code, a channel is
  nothing *but* code. An admin-created channel would be a row with no sender.
- **Keeping the outbox columns and allowing one channel per notification.** Free today.
  It makes the second channel a schema change plus a backfill later — which is the cost
  ADR-0044 spent the columns to avoid in the first place.
- **A key/value settings table for the matrix.** ADR-0063 named the second runtime setting
  as the one that should pay for a table. It should pay for a *typed* one: `(kind, channel)`
  is a composite key with two closed axes, and expressing it as strings gives up every
  check the database could make.
- **Per-person preferences first.** The honest default for a system nobody has received a
  mail from yet is one an administrator sets; opt-out matters once there is enough traffic
  to want less of it.
