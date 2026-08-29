# ADR-0050. One grid for everybody; half-days; the split cell

**Status:** accepted, amends ADR-0043. Its **cell rendering is amended** by
[ADR-0052](0052-two-flows-drafts-for-shifts-approval-for-everything-else.md): an absence
fills the cell rather than sitting in the band. Its argument against half-day *coverage*
is restated more honestly there — the boundary hour is derivable, and what actually blocks
it is integer minimums throughout the calculator.

## Context

Three problems that turned out to be one.

**The grid was role-blind.** `roleAtLeast` was exported and used *nowhere*. A Viewer saw
the whole editing surface — the shift palette, the right-click picker, drag painting — and
the first edit called `POST /api/drafts`, got a 403, and the rejection propagated into
nothing. The person clicked and nothing happened, with no explanation. That is precisely
the failure [ADR-0023](0023-editing-arms-itself.md) exists to prevent, reintroduced from
the other direction.

**Self-service lived on its own screen.** Asking for a Tuesday off is a statement about a
*cell*, and making somebody leave the schedule to say it is the separate-portal problem
[ADR-0047](0047-absorb-the-self-service-portal.md) set out to remove.

**Presence was hiding.** [ADR-0043](0043-presence-is-an-orthogonal-range-entity.md) put it
in an 8px corner glyph because the corner was the only unspent channel in a 28px cell.
That was an honest reading of the constraint and the wrong answer to the question: if
where somebody works matters enough to record, it matters enough to see.

Half-days then forced the issue. "Remote in the morning, in the office after lunch" and a
half-day of leave cannot be said by a corner mark at all.

## Decision

### One grid, editability by role

The same screen for everyone, gated by `useCapabilities()`:

| | Planner | Everyone else |
|---|---|---|
| Shifts, markers, paint, publish | yes | no |
| Their own presence and requests | yes | yes |
| Somebody else's | yes | no |
| Cell history | yes | yes |

The picker stays **one menu** for the whole grid (the perf constraint from ADR-0014 is
unchanged); its *contents* depend on the role. An approver additionally gets
Approve/Decline inline for a request covering that cell.

**The common actions are one click, not a dialog.** Remote, in the office, another
office, travelling, on customer site, and the three most-used absence types are menu
items that write immediately. A dialog survives behind *More…* for the long tail. Two
menu entries that each opened a modal — which is what shipped first — turned a
two-second thought into a chore.

**Your own row is always present and always marked.** `isIncluded` decides who is
*planned*; managers are false and hold no shifts, but they still work somewhere and still
take leave, so excluding them left them no way to record either.

`withDraft` now catches, so a refused edit says why instead of doing nothing.

### Half-days are a portion, not a time

```
Absence.portion        : FULL | MORNING | AFTERNOON
PresenceRecord.portion : FULL | MORNING | AFTERNOON
```

**Deliberately not times.** Comparing a half against a shift's actual window needs a
boundary hour, and any hour we picked would be invented. So:

> **Coverage stays whole-day.** `portion` drives rendering and the wording of a conflict.
> It does not produce fractional staffing.

The `(person, date)` uniqueness invariant is untouched: somebody on leave in the morning
and on a shift in the afternoon still holds exactly **one** assignment, with a partial
absence beside it. `EventType.allowsHalfDay` decides whether a type offers the choice at
all — furlough is not taken in mornings.

### The cell splits horizontally

Row height goes 28px → 32px.

```
┌──────────────┐
│   ▛ Crew ▟   │  chip: what they are doing        (top, flexible)
├──────────────┤
│ ░R░│  O·NY   │  band: where they are / pending   (bottom, 11px)
└──────────────┘
  AM     PM
```

- The band is drawn **only when there is something to say**, so an ordinary cell keeps the
  chip vertically centred in the whole height.
- A `portion` other than `FULL` takes half the band — or half the top row, when the
  absence owns it — on the side it falls. Only a whole day is hatched.
- **A shift and an absence never hide each other.** With no shift, leave *is* the day and
  owns the top row; with a shift, the roster is the duty and the leave moves to the band.
  Before this an absence over a shift set a conflict flag and then disappeared from the
  cell.
- A **pending request is dashed**, always. It is a proposal, and must never read as a fact.
- Presence is **coloured by kind** and drawn quieter when it matches the person's
  baseline. ADR-0043's "only draw a departure from the baseline" rule is **reversed**:
  presence records are sparse, so that rule hid the only records there were.

Cost: ~320px more scroll over 80 people. Bought: two facts visible at once instead of one
hiding in a corner.

The **portion toggle** sits at the head of the self-service section and applies to
whatever you click next — the same idea as the shift palette's active shift. It costs
nothing for a whole day and one click otherwise.

`GridCell` keeps taking **primitives** — glyph and label as separate strings, portion as a
string — because it is memoized across ~2500 instances and an object prop would be a new
reference every render.

### Pending requests are a third projection

`engine/requests.ts` sits beside `cellValue` and `presence`, over the same cell keys. Same
reasoning as ADR-0043: a pending request is not a competing answer to "what is this person
doing", it coexists with whatever the cell already says. `cellValue.ts` is untouched
again, which is the test that the pattern is right rather than merely repeated.

Nothing materialises until approval, so a pending request is never counted as an absence
by any engine.

### Layers

A cell can carry a shift, an absence, where the person is, and something they have asked
for. All four at once is a lot in 62×32 pixels, and which of them matters depends on why
you opened the screen.

So they are **layers you switch off** — Shifts, Time off, Presence, Requests — rather than
a compromise nobody chose. All on by default; the toggles sit in the toolbar where the
`+ Absence` and `+ Presence` buttons used to be. Masking happens at render, not in the
projection, so turning a layer back on costs a render and not a recompute of the month.

Those two buttons are gone: right-click does both in one click each, on the cells you had
already selected, and a second route needing the same selection was only ever more to look
at.

### Day history

Right-click a **date header** for everything that happened that day, to everybody —
`GET /api/history/cell?date=` with no `personId`. A conflict is rarely one person's story,
and "who moved what, in what order" needs the whole day on one axis. Every line names its
subject in that view; the single-person view does not repeat it.

## Consequences

- `GET /api/schedule` carries `pendingRequests` for the window — outside `plan`, because
  the plan is what has been decided.
- The Requests screen keeps the approvals queue, now **grouped by person**: an approver
  decides about people, and three asks from the same person are one conversation. Raising
  a request moves to the grid.
- Approving from the grid needs no new endpoint; the picker calls the same
  `POST /api/requests/{id}/decide`.
- A non-planner's absence dialog raises a *request* instead of writing directly — unless
  the type says no approval is needed, in which case everyone records it (sickness).

## Alternatives considered

- **A 3px coloured stripe down the cell's left edge.** Costs no height, and cannot say
  *which* office without a tooltip, cannot show a half-day, and carries its meaning in
  colour alone — which ADR-0007's own accessibility rule forbids.
- **Split the cell vertically into AM/PM as the primary geometry.** The most expressive
  option, and 31px per half is not enough for a shift code. Half-days are the exception;
  making them the layout would cost every ordinary cell.
- **Keep Requests as the only place to ask.** Rejected by the same argument that retired
  the portal: the answer belongs where the question is.
- **Hide the grid from non-planners entirely.** They need to see the rota — that is
  `Docs/00`'s first stated goal. Read-only was never the problem; *pretending* to be
  editable was.
- **Keep presence and time off behind dialogs.** This is what shipped first, and using it
  settled the question: a dialog is right when there is something to *compose* — a range,
  a type, a note — and wrong when the answer is one word the menu already knows. The
  dialog stays for the long tail, where it earns its place.
- **Ask for a specific office every time.** Rejected in favour of "In the office" meaning
  the person's own baseline office, with the others one disclosure away. Nearly everyone
  has one office and should not have to name it.

## Note on the dev identity switcher

Switching who you are acting as (ADR-0039's stub fallback) had three faults worth
recording, because each has a general lesson:

- The override was derived from the auth query, so the picker showed nothing until the
  round trip landed and read as "the dropdown does not select". **A control's own state
  must not depend on a fetch it triggers.**
- It called `queryClient.clear()`, which drops the cache *and* its observers, so every
  screen briefly had no data. `resetQueries` refetches without tearing the tree down.
- `useSchedule.load()` did not depend on identity, so screens kept the previous person's
  answer until something else changed the unit or the period. **What the server filters by
  identity has to be a dependency of what reloads it.**
