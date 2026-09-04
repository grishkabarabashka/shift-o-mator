# Self-service — presence, requests and the inbox

**User question:** "Where am I working next week, how do I ask for time off, and what
needs my decision?"

This is the screen most of the eighty people ever use. Everything else in this product is
built for the handful of planners; this is built for everyone else, and it is the reason
[ADR-0047](adr/0047-absorb-the-self-service-portal.md) brought the separate portal in
rather than integrating with it.

## Presence

Where someone physically works on a day: **remote**, **an office** (which one), **travel**
or **a customer site**. Orthogonal to whether they work at all — a person on the `Crew`
shift is *also* one of those four
([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)).

### Declaring it

Presence is a statement about a **range**, not a cell, so it is entered the way leave is:
select a rectangle on the grid and right-click. One record per selected person, bounded by
the selection's outermost columns.

An office, travel or a customer site is recorded directly — they are statements of fact.
**Remote goes through an approval** and appears dashed until somebody decides, unless a
planner is recording it, in which case it is a fact too.

Unlike every other grid edit, **this does not open a draft** ([ADR-0023](adr/0023-editing-arms-itself.md)
does not apply). Presence is not a roster decision: it never affects coverage, never
blocks a publish, and belongs to the person it describes. Waiting for a planner to publish
"I'm remote on Tuesday" would make the feature pointless. The write goes straight to the
server, versioned and audited.

Who may write it: **your own record, or you are a Planner**
([ADR-0046](adr/0046-routing-is-not-authorization.md)).

**Absence works exactly the same way**
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)). It used
to be staged in a draft, which had both halves of the presence argument against it: a sick
day sat invisible until an unrelated planner published, and recording one called a
planner-only endpoint, so a viewer reporting their own sickness got a 403.

What replaces the draft's review step is **approval**, and it is a better one because it
names the human who decided. A kind of absence with `requiresApproval` cannot be written
directly by anyone — planner included — which is what makes the direct endpoint safe to
expose to everybody.

### Reading it

Two readouts, answering two different questions.

| Where | Question | Form |
|---|---|---|
| Grid cell | "Where is this person?" | A coloured band across the bottom — `R`, `O`, `T`, `C`, or `O·N` for an office that is not their usual one |
| Coverage strip | "Is anyone in the Chicago office on Friday?" | An `on site / remote` row, per day |

Each kind has its own hue — office green, remote blue, travel amber, customer site purple
— because "where is everyone" is answered by scanning, not reading.

The cell is **two stacked rows** ([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)):
the shift chip owns the top, presence and pending requests own the bottom. They are
different kinds of fact — what somebody is doing versus where they are and what they have
asked for — and both are true at once, so neither may hide the other.

```
┌──────────────┐
│   ▛ Crew ▟   │  what they are doing
├──────────────┤
│ ░R░│  O·NY   │  where they are  (AM │ PM)
└──────────────┘
```

A **pending request is dashed**, always: it is a proposal, and must never read as a fact.

### One day, one record

An approved request **supersedes** what already covered those days
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).
Approving "remote on Wednesday" over an existing "office Mon–Fri" leaves office Mon–Tue,
remote Wednesday, office Thu–Fri — the old record is *trimmed*, not deleted, because the
days it did not lose are still true.

It used to add a second row and let the projection render whichever it reached last, so the
day did not change — which is the one thing the approval was for. The same rule applies to
direct writes, and to absences: **changing the kind of leave on a day is a new request that
supersedes the old one**, not an edit of it. Editing the type in place would have skipped
the approval.

Half-days are respected only where they are unambiguous: a whole day supersedes anything,
the same half supersedes itself, and a morning and an afternoon leave each other alone. A
half deliberately does **not** trim a whole day — that would silently discard the other
half.

Pending marks are **not filtered by planning unit**. The grid deliberately shows rows from
outside the selected unit — your own row always, and everyone holding a shift in the unit
when that toggle is on ([ADR-0032](adr/0032-planning-unit-single-rule-axis.md)) —
so filtering the overlay by the request's own unit blanked the mark on exactly those rows.
A request raised by an admin from another unit disappeared the moment the scope changed,
which read as "it was not saved". Membership of the roster on screen is the only filter.
The band is drawn only when there is something to say, so an ordinary cell keeps the chip
centred in the whole height.

**A shift and an absence never hide each other.** With no shift, leave *is* the day and
owns the top row. With a shift, the roster is the duty and the leave moves to the band —
they are separate records and both are true at once. Before this an absence over a shift
set a conflict flag and then vanished from the cell entirely.

A half-day is drawn as half, on the side it falls, whether it owns the top row or sits in
the band. Only a whole day is hatched: hatching the entire cell for a morning would
overstate it.

**Every recorded day is shown**, with a to-baseline day drawn quieter than an away day.

> This originally drew *only* departures from the baseline, on the theory that rendering
> the rest would fill 2500 cells. That was wrong about the data: presence records are
> sparse, so the rule hid the only records there were — marking "in the office" on your own
> office day appeared to do nothing at all.

The glyph is suppressed entirely on non-working cells — "remote while on vacation" is
noise — and its meaning is spelled out in the cell's tooltip **and** `aria-label`, never
carried by shape alone.

The strip row hides itself entirely when nobody has declared anything, so a team that does
not use the feature never sees a row of zeros.

### Layers

A cell can carry a shift, an absence, where the person is and something they have asked
for. Which of those matters depends on why you opened the screen, so the toolbar carries
**Show: Shifts · Time off · Presence · Requests** — turn off what you are not looking at.
All on by default.

Turning **Shifts** off is how you ask "where is everyone this week", so presence stops
being a 9px strip under an empty chip and takes the whole cell. Nothing is recomputed —
the chip row simply has nothing in it left to make room for.

## Asking for things — from the grid

**Raising a request happens on the schedule, not on a separate screen**
([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)). Asking for a Tuesday off
is a statement about a cell, and making somebody leave the rota to say it is the
separate-portal problem this product set out to remove.

One grid for everybody. What differs is what you can touch:

| | Planner | Everyone else |
|---|---|---|
| Shifts, painting, publishing | yes | no |
| Their own presence and requests | yes | yes |
| Somebody else's | yes | no |
| Cell history | yes | yes |

Right-click is the single entry point everywhere in the grid, including the **date
header**, where it opens that day's history for everybody. Its contents follow the role,
and **everything common is one click** — no dialog:

```
[ Day ][ AM ][ PM ]            ← applies to whatever you click next

Where I'm working                ← "Where Dana works" on somebody else's row
  Remote                       needs approval
  In the office
  › Another office (3)
  Travelling
  On customer site

Time off
  ▪ Annual leave               needs approval
  ▪ Sick leave
  ▪ Floating holiday           needs approval
  More kinds of absence…
```

The heading names the row when it is not yours, and the request is filed **against the
person whose cell was clicked**. Both halves of that were missing: a planner asking for
leave on an engineer's row got leave for themselves, under a heading that said "Where I'm
working".

A planner records remote directly, like any other presence — approval is what a request
is *for*, and a planner asking themselves for permission is a round trip to nowhere.

When a right-click lands on a **selection**, the decision buttons cover every pending
request the selection touches, de-duplicated: one request spanning five painted cells is
one decision. Reading only the clicked cell meant no Approve button whenever the click
landed on a day the request did not cover.

The **portion toggle** costs nothing when you want a whole day, which is nearly always,
and one click when you do not — cheaper than a modal with a dropdown in it. A dialog
survives behind *More…* for the long tail.

A planner gets that plus the planning actions; anyone a request is waiting on gets
**Approve / Decline** inline on the cell it covers.

**Your own row is always there and always marked** — tinted, with an accent edge and a
"you" tag. Managers are `isIncluded: false` and hold no shifts, but they still work
somewhere and still take leave, so excluding them from the grid left them no way to record
either.

> Before this the grid was role-blind: a viewer saw the palette and the shift picker, the
> first edit was refused server-side, and the rejection went nowhere — the click did
> nothing and said nothing.

## My calendar, and a feed

**Your own months, in a different shape** ([ADR-0055](adr/0055-a-personal-calendar-and-a-feed.md)).
`/me` builds a dataset of **one** person and runs `projectCells`, `projectPresence` and
`projectRequests` — the same three the grid runs — then hands a day to
`CellSelfServiceMenu` in a floating shell. Nothing about what a day means, or what needs
approving, is decided twice.

A day is a box with room for the shift code and its hours, so it reads without decoding.
Months with no shifts are normal: a rota that has not been published yet is not an error,
and leave can be booked on a day that has no shift. Managers get no special view — a manager
is an ordinary person with their own calendar, and looking at the team is what Schedule is
for.

It reads its own long window through the `['my-calendar']` query key, so every direct write
and every request mutation has to invalidate that key as well as `['schedule']`.

**Subscribing.** The sidebar carries the address of a personal iCalendar feed — shifts as
timed events, leave and comp days as whole days. That address **is** the credential: a
calendar client cannot carry a bearer token, so `Person.CalendarToken` is the whole of the
feed's authentication. Hence 256 bits, never on any list payload (`[JsonIgnore]`, so
`/api/reference` cannot hand out everybody's), replaced at seed time so the fixture's
guessable `tok-{personId}` never survives, and **Reset the address** beside the copy button
— the button you need the day somebody pastes the link into a shared document. A wrong
token answers 404 exactly as an unknown route does.

## Taking a comp day

**Who:** the person who earned it. Signed off by an `Approver`
([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

The accrual and the placement are two different things, and only the first belongs to the
planner:

1. A weekend or holiday shift **accrues** a comp day when the draft is published, linked to
   the assignment that earned it — so "where did this day off come from" always has an
   answer.
2. The system **proposes** a date from the unit's comp-off policy: the earliest free
   eligible day in the search window, excluding Mondays and Fridays by default.
3. The person opens the comp day from the grid or My calendar and **asks for a day** — the
   proposal, or any other day the policy allows. `CompDayPlacement.Check` holds those rules
   so the client and the server cannot disagree about which dates are offered.
4. **At most one request stays live per comp day**
   ([ADR-0056](adr/0056-one-live-comp-day-request.md)): asking again cancels the earlier
   one, so an approver's inbox is never asked to decide between two proposals for the same
   day off.
5. Asking does not move the day. An approver signs it off, and only then is the date set and
   the day blocked.

Comp days never expire; `agingThresholdDays` flags anything outstanding too long — a manager
alert plus a standing notice for the person ([ADR-0007](adr/0007-comp-day-as-balance.md)).

## The queue

Two lists on one screen, at `/requests` — a **queue**, not a form.

```
┌────────────────────────────────────────────────────────────┐
│  Ask for something                                         │
│  [ What ▾ ] [ From ] [ To ] [ Office ▾ ] [ Note    ] [Send] │
├────────────────────────────────────────────────────────────┤
│  Waiting on you                                            │
│  Dana Cruz  Annual leave  12–16 Oct  [Awaiting approval]    │
│                            [ comment ] [Approve] [Decline]  │
├────────────────────────────────────────────────────────────┤
│  Your requests                                             │
│  Work remotely  9 Oct  [Approved]           [Withdraw]      │
└────────────────────────────────────────────────────────────┘
```

**The approver list comes first.** Your own list is a record; the inbox is a queue, and a
queue nobody is looking at is the failure mode self-service cannot survive.

The approver list is **grouped by person**: an approver decides about people, and three
asks from the same person are one conversation, not three rows.

The form at the top still works for a request that is not about a particular cell — but
the grid is the fast path.

### Kinds of absence are data

Annual leave, sick leave, floating holiday, personal day, unpaid leave, furlough — all
`EventType` rows, not enum members
([ADR-0049](adr/0049-event-types-are-data.md)). Each carries its own behaviour:

| Flag | What it decides |
|---|---|
| `blocksAssignment` | whether the person can still hold a shift that day |
| `countsTowardCapacity` | whether it counts against the simultaneous-absence limit |
| `requiresApproval` | whether it is a request or a direct record |
| `allowsHalfDay` | whether the half-day choice is offered at all |
| `isActive` | retiring a kind. There is no delete: absences point at these by id, and a deleted kind would leave rows nobody can name |

All of it is edited on **Settings → Leave types**, including the colour that fills the
cell and the short label a 62px column shows. Both are matters of taste, and neither
should need a deployment.

Two defaults worth knowing.

**Sickness needs approval**, like any other leave. It briefly did not, on the reasoning
that you are already off and asking would be theatre — which described the notification,
not the record: a sick day still has to be accepted by somebody before it stands as the
reason a shift went uncovered, and the person reporting it is rarely the person who signs
it off ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)).

**Sickness does not count toward capacity** — flagging the team because three people fell
ill helps nobody. That half was right and stands.

The one type that needs no approval is **`Not available`**, because it is a declaration of
availability rather than a request for time: an engineer saying "do not put me on a shift
that weekend". It is what replaced the deleted `OFF` / `0` roster markers.

And one rule that keeps the model from sprawling: **there is no `countsAsCoverage` flag,
because if it counts as coverage it is a `Shift`.** An admin adding a leave type cannot
affect coverage arithmetic; there is no field through which they could.

### Half-days

Absences and presence both carry `portion`: whole day, morning, or afternoon
([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)).

Deliberately **not** times. Comparing a half against a shift's actual window needs a
boundary hour, and any hour picked would be invented — so coverage stays whole-day and
`portion` drives rendering and the wording of a conflict.

The `(person, date)` invariant is untouched: somebody on leave in the morning and on a
shift in the afternoon holds exactly **one** assignment, with a partial absence beside it.

### States, in words

| State | Shown as | Meaning |
|---|---|---|
| `SUBMITTED` | Awaiting approval | Sitting in somebody's inbox |
| `DRAFT` | Returned to you | An approver sent it back with a comment; amend and resubmit |
| `APPROVED` / `APPLIED` | Approved | Granted. `APPLIED` additionally means the leave or presence exists |
| `APPLY_FAILED` | Approved, not applied | The decision stands; the write did not go through, and the reason is shown |
| `REJECTED` | Declined | With the approver's comment, which is why it is shown |
| `CANCELLED` | Withdrawn | By the requester, or a planner on their behalf |

**A declined request always shows why.** A bare "Declined" with no reason is what makes
people re-ask by email, which is the process this replaces.

### Withdrawing

Available before *and* after a request takes effect. Withdrawing an applied request removes
the leave or presence it created — leaving it behind would show the roster something the
person explicitly took back, and would move the cleanup to a planner.

## History

Two views, same stream.

- **History…** in a cell's menu — everything that happened to that (person, date).
- **Right-click a date header** — everything that happened that day, to **everybody**, with
  each line naming its subject. A conflict is rarely one person's story.


Both merge schedule changes, absences, presence, when a request was submitted and when it
was decided onto one time axis.

The question they exist for is not "what changed" — the audit log answers that — but **in
what order**. Was the leave request in before or after the rota was moved? Who got there
first? Two lists cannot answer that; one ordered stream can
([ADR-0050](adr/0050-one-grid-half-days-and-the-split-cell.md)).

Readable by everybody. "Who changed this, and when did the request come in" is not a
privileged question.

## Who decides — roles and approvers

Roles are a **set**, granted per planning unit
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)). Nothing is implied by ordering: holding
two roles grants both, and holding one grants only it.

| Role | Owns | Notably does **not** |
|---|---|---|
| `Viewer` | Reads the rota; self-service on their own row. Everyone signed in. | — |
| `Planner` | Shifts, painting, publishing, and the comp-day accrual that comes with them | Approve anybody's leave |
| `Approver` | Decides requests raised by people in the unit | Touch the rota |
| `Admin` | Configuration, and role grants | **Assign shifts** |

That last cell used to be false. Policies compared roles by ordinal, so `Admin > Planner`
made every administrator a planner of every unit — a right nobody had granted and nobody
could withhold. The comparison is gone.

A grant names a unit, or is **global** (`unitId` null), which satisfies every unit for that
role. Global widens *scope*, never *privilege*: a global Admin is an admin everywhere and
still not a planner anywhere. Configuration that belongs to no unit — locations, holidays,
the units themselves — needs a global Admin.

Grants live in the **database**, not the token, and are edited on **Settings → Roles**: a
matrix of people against roles, filtered by unit. Planning units are this product's own
concept, and an identity provider has no idea what `unit-emea` is. A grant takes effect on
the next request rather than the next token refresh.

Granting is itself scoped. A unit's admin manages that unit's grants; only a **global**
admin can make a global one, which is what stops a unit admin promoting themselves out of
their unit. Revoking the last global admin is refused, because nothing else could grant it
back.

### Whose inbox

The **approvers of the subject's unit**. That is the whole rule.

Where a unit has no approver configured it falls through to the admins — the people who can
fix the cause. A request must never resolve to nobody, because an empty inbox is the
failure nobody notices, and one that still resolves to nobody is **refused at creation**
rather than accepted into limbo.

The first decision settles it. With a single list of equal approvers there is nothing for a
second to add.

> **What was here before.** An `ApprovalRoute` table of ordered steps, each resolving
> through a strategy (`MANAGER`, `NAMED`, `UNIT_PLANNERS`, `UNIT_APPROVERS`) in `ANY` or
> `ALL` mode, with a skip-forward rule so an unresolvable step did not strand a request
> forever. It modelled manager-then-HR approval nobody had asked for, had no admin screen,
> and its most-used strategy was "the people named on the unit" — which is now just the
> role. All of it is deleted (ADR-0051). If a leave type ever genuinely needs two steps, it
> comes back as a new ADR with a screen attached.

### Approval is a property of the thing, not of who asks

A **planner** recording leave on somebody else's row raises a request, like anybody else.
`requiresApproval` on the kind of leave decides, and remote presence always does; the
asker's role does not enter into it. A planner owns the rota, not other people's time off.

The write-access question is separate: a planner of your unit may *act on* your row at all.
What they may do there is decided by the thing they are recording.

## The inbox

A bell in the shell, with an unread count.

Notifications are rows written **inside the same transaction** as the change that caused
them ([ADR-0044](adr/0044-in-app-inbox-first.md)) — so one cannot be lost to a crash
between the state change and the send, because there is no send. The client polls once a
minute; there is nothing here that a minute of latency harms.

Sent on: a request needing your decision, your request being approved or declined, and an
approval that could not be applied — that last one goes to **both** the requester and the
approver, because neither can infer it from the other's screen.

Two things the product already promised and could not deliver, for want of anywhere to
deliver them, now have a home: the comp-day aging alert
([ADR-0007](adr/0007-comp-day-as-balance.md) — *"a manager alert plus a standing notice for
the person"*) and the absence-import impact list.

External delivery — email or Teams via Graph — is not switched on, but everything that
decides it now exists ([ADR-0064](adr/0064-a-notification-policy-and-a-log.md)). An
administrator ticks a cell of the (event × channel) matrix on **Settings → Notifications**,
and from then on each notification is written with a `NotificationDelivery` per channel it
is owed on — in the same transaction, so the row records the policy in force when the event
happened. Those rows sit at `PENDING` until a dispatcher exists to send them, and the same
screen's log shows them waiting. A channel that is switched off leaves a row saying
**exactly that**, rather than nothing: "no row" would otherwise mean both "not owed one" and
"lost one".

## What this deliberately does not do

**Leave entitlement is not modelled.** No balance, no accrual, no carry-over, no pro-rata.
The product records that leave was asked for and granted; it does not compute how many days
anyone has left.

This is the boundary [ADR-0047](adr/0047-absorb-the-self-service-portal.md) does not cross,
and the one that will be pushed on. If a leave-balance question ever needs answering in
here, integrate or buy — statutory minima across five countries are a different product.
