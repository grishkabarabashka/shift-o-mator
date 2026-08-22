# Comp days

Time off earned by working a weekend or a public holiday. This is **an accrual with a
balance, not an event on the calendar** ([ADR-0007](adr/0007-comp-day-as-balance.md)).
It is the entity most easily overlooked at design time and the one that later surfaces
as a source of disputes, because it is adjacent to pay.

## Policy

Owned by the region.

```
CompOffPolicy {
  windowBeforeDays          how far before the earned date a comp day may be placed
  windowAfterDays           how far after
  excludedWeekdays[]        default: Monday, Friday
  agingThresholdDays        past this age an untaken entry is flagged
  requiresApprovalWhenNoSlot  true
}
```

**Comp days do not expire.** There is no deadline and nothing is ever lost. What the
policy carries instead is an aging threshold — see "Aging" below.

**A search window, not a fixed offset**
([ADR-0007](adr/0007-comp-day-as-balance.md) as amended). An earlier version of this
design used a fixed shift per trigger day — Saturday −2, Sunday +2, holiday +3. That
produces wrong dates the moment the proposed day is already occupied, excluded, or
another absence. The window model is what the validated prototype uses.

Monday and Friday are excluded by default because a comp day adjacent to a weekend
turns into a long weekend and drains cover on the days that need it most.

## Accrual

1. A planner assigns someone to a date that is non-working **by that person's
   location calendar** — a weekend day or a holiday affecting their location.
2. The system creates a `CompDayEntry` with status `PROPOSED` and a proposed date: the
   **nearest free eligible date**, searching outward from the earned date within
   `[earned − windowBefore, earned + windowAfter]` and preferring days *after* at equal
   distance. A candidate is eligible if it is not an excluded weekday, not already
   occupied by an assignment, absence or another comp day, and not itself non-working.

   > Nearest, not chronologically earliest. Taking the earliest date in the window
   > would put the comp day up to two weeks *before* the work that earned it. Searching
   > outward reproduces the team's existing defaults exactly: Saturday resolves to the
   > Thursday before (−2) and Sunday to the Tuesday after (+2), because the intervening
   > days are either weekends or the excluded Monday and Friday. Those defaults now
   > fall out of the policy instead of being hard-coded.
3. A dashed hint appears in the grid on the proposed date immediately. The planner sees
   the consequence of the assignment in the same moment, not a week later.
4. If no valid date exists, the entry is created as `PENDING_APPROVAL` and surfaced to
   the planner. It is never silently dropped.

**Saturday and Sunday are two independent earning events.** A person working both earns
two entries and two links.

Accrual is a **proposal**. Nothing is confirmed until the planner acts — otherwise a
mistake in the holiday calendar quietly corrupts a balance, and that balance is money.

## Lifecycle

```
              ┌──────────────┐
   earn ────▶ │   PROPOSED   │ ── planner declines ──▶ DECLINED
              └──────┬───────┘
                     │ confirm / move
                     ▼
              ┌──────────────┐
              │  SCHEDULED   │ ── date passes ──▶ TAKEN
              └──────────────┘

   no valid slot ──▶ PENDING_APPROVAL ── planner picks a date ──▶ SCHEDULED
```

There is no terminal expiry state: an entry stays owed until it is taken or explicitly
declined.

Only `SCHEDULED` and `TAKEN` block assignment. `PROPOSED` is the system's suggestion
and must not prevent the planner from doing something else with that day.

## Aging

An entry that is still `PROPOSED`, `SCHEDULED` or `PENDING_APPROVAL` more than
`agingThresholdDays` after its `earnedForDate` is **flagged, not lost**:

- **For the planner or manager** — an alert. Aged entries surface in the Dashboard
  attention list and as an `INFO` issue (`COMP_DAY_AGING`) anchored to the person.
- **For the person** — a standing indication that they have unused comp days, on their
  own schedule view and in the People panel.

Age is measured from `earnedForDate`, not from the proposed date: what matters is how
long the debt has been outstanding, not when someone last moved it.

The threshold is configuration, expected in the region of one to two weeks. It is a
prompt to act, never an enforcement.

## Links and deletion

`CompDayEntry.earnedForAssignmentId` is the link back to the earning weekend or holiday
duty. It is never dropped: a comp day whose origin is unknown cannot be defended in a
conversation with the person who earned it.

When the earning assignment is removed:

- a `PROPOSED` entry is withdrawn silently — it was only a suggestion;
- a `SCHEDULED`, `TAKEN` or `PENDING_APPROVAL` entry requires an explicit decision from
  the planner. The system never revokes time off somebody has already been promised.

## Balance

Per person, over a period:

| Figure | Meaning |
|---|---|
| Earned | Entries created from qualifying work. |
| Scheduled | Confirmed and placed on a date. |
| Taken | Scheduled dates that have passed. |
| Pending | Awaiting approval because no valid slot existed. |
| Aged | Untaken past `agingThresholdDays`. A prompt, not a loss. |
| Due | Earned but neither taken nor declined. |

An accumulated balance of unused days is a management signal that is currently
invisible in the spreadsheet world. It appears on the People screen per person and in
Analytics in aggregate.

## Interaction with other rules

- A confirmed comp day counts as an absence for the simultaneous-absence limits
  ([ADR-0010](adr/0010-absence-limits-by-role-pool.md)).
- A confirmed comp day blocks assignment exactly as a vacation does.
- Working a holiday may earn a comp day; whether it does is regional policy, not a
  constant.
- Comp day dates are stored without time. Timezone conversion is display-only.
