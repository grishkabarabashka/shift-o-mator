# ADR-0052. Two flows: drafts for shifts, approval for everything else

**Status:** accepted. Supersedes the roster markers in
[ADR-0017](0017-absence-range-cell-projection.md), narrows the draft scope in
[ADR-0015](0015-optimistic-drafts-and-publication.md), amends the cell rendering in
[ADR-0050](0050-one-grid-half-days-and-the-split-cell.md), and reverses the sickness
default in [ADR-0049](0049-event-types-are-data.md).

## Context

Two unrelated things had been sharing one mechanism.

A **draft** exists so a planner can rearrange the rota privately, see the consequences,
and publish the lot as one atomic decision (ADR-0015). That is a good mechanism for the
rota. It was also carrying **absences**, and every property that makes it good for the
rota makes it wrong for time off:

- A sick day recorded on Tuesday stayed invisible until some planner happened to publish
  something. Nobody was waiting for that publish; nobody knew it was needed.
- Recording one called `POST /api/drafts`, which is a planner endpoint. A viewer
  recording their own sick day got a 403 from an endpoint they had no business calling.
  The symptom read as "it says I have no rights", and the cause was that time off was
  being treated as a rota edit.
- The draft's value is *review before it becomes real*. Time off already has a review
  step — approval — and it is a better one, because it names the person who decided.

Alongside that, the cell model still carried the **roster markers** `OFF` and
`NOT_SCHEDULED` (ADR-0017's "`0` ≠ blank"). They recorded "considered, and deliberately
not scheduled" as distinct from "nobody has looked at this yet". The team did not use the
distinction, and what they were actually reaching for — "do not put me on a shift that
weekend" — was better said as an absence, because absences are already understood by the
capacity check, the conflict check, the cell projection and the layer toggles.

And absences were drawn as a 9px band under the shift chip. Being on leave is a statement
about the whole day, and the eye has to be able to sweep a month and see who is out.

## Decision

### Drafts publish the rota. Nothing else goes in them.

`DraftTargetType` loses `Absence`. `/api/absences` gains full CRUD, with the same
`Version` token and the same `ChangeHistoryEntry` the draft was providing.

Comp days **stay** in the draft, because a comp day is *earned by* a weekend shift in the
same draft: accruing one for a shift that might still be withdrawn before publication
would credit work nobody has committed to.

| | Written through | Reviewed by |
|---|---|---|
| Shifts | draft → publish | the planner, before publishing |
| Comp-day accrual | draft → publish | same, it comes with the shift |
| Absences | direct | an approver, when the type says so |
| Presence | direct | an approver, for remote |
| Comp-day placement | request | an approver |

### Approval is a property of the thing, not of who asks

Established in [ADR-0051](0051-roles-are-a-scoped-set.md), and this is where it bites:
`/api/absences` **refuses** any `EventType` with `RequiresApproval`, from anybody. A
planner recording somebody's leave raises a request like everyone else. The endpoint is
therefore safe to expose to every authenticated caller, which is what makes the direct
path work at all.

**Sickness now needs approval.** ADR-0049 defaulted it to none, reasoning "you are already
off — approval would be theatre". That described the *notification*, not the record: a
sick day still has to be accepted by somebody before it stands as the reason a shift went
uncovered, and the person reporting it is rarely the person who signs it off. It keeps
`CountsTowardCapacity = false` — that half was right.

### The roster markers are deleted

`RosterMarker`, `AssignmentContentKind` and `Assignment.Marker` are gone. **An assignment
is a shift.** A row exists exactly where somebody is working, and an empty cell means no
shift — nothing more.

What replaces the useful half is a seeded event type, `UNAVAILABLE` ("Not available"): an
engineer says "do not put me on a shift that day". It needs no approval, because it is a
declaration of availability rather than a request for time; it does not count toward
capacity, because it is not time off; and a planner can still assign over it and get the
same flagged conflict any absence produces.

This costs the "considered and rejected" versus "not yet looked at" distinction. That is
the point: one of those was never recorded honestly anyway, since nothing forced a planner
to mark a cell they had decided to leave alone.

### An absence fills the cell

Not a band. The event type's colour, at 30%, behind the whole cell — half of it for a
half-day, on the side it falls. The hatching that used to mark a closed-out day is gone
with it: two treatments for one fact competed.

A shift on the same day keeps its chip, drawn **over** the fill, with the cell flagged as
a conflict. Forbidding the combination is tempting and wrong: somebody off in the morning
who works the afternoon is a real roster, and refusing it would push that case out of the
tool and back into a spreadsheet.

> **The better answer, deliberately not taken yet.** If shifts themselves expressed
> half-days, coverage could count halves, and absence-plus-shift could then be forbidden
> outright because the legitimate case would have a legitimate representation. ADR-0050
> rejected half-day coverage on the grounds that comparing a half against a shift window
> needs a boundary hour and any hour would be invented — which is weaker than it looked:
> the boundary is derivable from *that shift's* own window. What actually blocks it is
> that coverage minimums are integers all the way through the calculator, the validator,
> the strip, the digest and their tests. That is a phase of work, not an afternoon, and it
> is recorded in `Docs/13-roadmap.md` rather than half-done here.

### A comp day is placed by the person taking it

The accrual is unchanged: created at publication, linked to the assignment that earned it,
auto-placed on a proposed date per policy. What changes is who settles the date.

The engineer picks a day and **asks** for it; an approver signs it off. It used to be a
planner writing the date straight into a draft, which put the person whose day off it is
out of the loop entirely.

`RequestMaterializer.CompDay` creates nothing — it sets `ActualDate` and `Status` on the
existing accrual, so the link back to the earned weekend survives the placement and the
balance cannot count the same Saturday twice.

The rules live in `CompDayPlacement.Check`, in Application, because the same question is
asked from two directions: the client greys out dates it will not offer, and the server
refuses ones it is asked for anyway. Two implementations would disagree the first time
either was edited, and the disagreement would surface as a date the UI offered and the
server rejected. Placement is validated **before** the request is raised — an approver is
being asked "is this a good day for the team", not "is this date legal".

## Consequences

- `AbsenceEndpoints` is new; `DraftService.AppendAbsenceChange`, `ApplyAbsenceChange` and
  the absence branch of the publish conflict check are deleted.
- The absence **import** writes directly, one row at a time. It used to be one draft batch
  that a single Undo rolled back; there is no batch now, and the preview screen is what
  makes that acceptable — nothing is written until the planner has seen the diff.
- The cell menu loses its "Non-working" block: `Off`, `0 — not scheduled`, and the
  `Leave / sick…` item that was a third route to actions the self-service section already
  offers one click away. "Edit absence…" survives, and only when there is one to edit.
- `CellStatus` drops to `PH | COMP_OFF | ABSENT`.
- The fixture's marker rows are dropped at seed time rather than converted: there is
  nothing to convert them to.

## Alternatives considered

- **Keep absences in the draft and fix the permissions.** The permission error was a
  symptom. The invisible-until-published problem has no fix inside a draft, because that
  is what a draft *is*.
- **Keep `OFF` as a marker and add `UNAVAILABLE` as well.** Two ways to say the same thing,
  differing only in which subsystems understand them. The marker was the one no subsystem
  understood.
- **Forbid a shift on a day with an absence.** Rejected on the half-day case, and it would
  have reversed ADR-0024/0035, which are right: a conflict is a decision still to be made,
  not corrupt data.
- **A second entity for a placed comp day.** It would double-count the balance and split
  the link to the earning shift across two rows.
