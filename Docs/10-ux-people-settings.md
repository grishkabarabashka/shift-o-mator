# People and Settings

## People — roster, fairness and comp-off

**User question:** "Who is in the team, what can they do, how much have they worked,
and what time off is owed?"

Title row with `People` and a 260px search field. Split layout: scrollable table left,
detail panel right when a row is selected.

### Table

| Column | Notes |
|---|---|
| Name | With muted initials |
| Unit | Which rules apply and whose screen they appear on |
| Location | |
| Shift | The person's contracted window (if set) |
| Days (3mo) | Working days in the last three calendar months |
| Comp-Off | Available balance |
| Eligible Shifts | Colored shift badges |
| Weekend | Check or dash |

The unit filter applies. Search matches display name, location and eligible
shift code. The footer reports visible versus total included people.

### Person panel

1. Header: name, unit tag, shift, close button.
2. Period label: the last three calendar months.
3. KPI strip: Working Days, Weekends, Comp-Off Due.
4. **Fairness banner**: above, below or on target against the unit team average,
   with a ±12% tolerance.
5. **Comp-Off tiles**: Earned, Taken, Pending, Due, and **Aged** — outstanding longer
   than the configured threshold. Comp days never expire; an aged tile is a prompt, not
   a loss. See [05-comp-days.md](05-comp-days.md).
6. **Shift Mix**: one row per shift with a colored badge, a percentage bar, the
   percentage, the count, and **a marker for the person's `targetShare`** so deviation
   is visible rather than inferred.
7. Expandable **Profile & Configuration**: location, org category, week pattern,
   default entry, weekend eligibility, eligible shifts, constraints and preferences.

Selection is read-only. Admin editing is an explicit edit state with Save and Cancel,
and **must never silently alter an open draft**.

### Administration

- Add, edit, deactivate and reactivate people **without deleting assignment history** —
  deactivation removes someone from future planning, nothing else.
- Unit is the sole rule axis (where they work, whose screen they appear on).
- Shift-eligibility checkboxes with target shares, default shift, default entry, weekend
  eligibility, `maxWeekendsPerQuarter`, blackout dates and preferred partners.
- History stays attached to the stable person ID.

## Settings — the scheduling model

**User question:** "What rules drive the schedule, and how should the product display
it?"

A vertically scrolling sequence of cards.

### User Preferences

Home unit. Display defaults.

### Display

**The display-timezone picker lives here**, not in the header. The header carries a
read-only strip of location clocks instead; choosing a zone is a preference set once, not
a control reached for on every screen.

Switches: show Off/Leave days, show weekends, highlight coverage gaps, highlight
scheduling conflicts.

### Unit configuration

One card per unit, each containing:

- editable unit name;
- unit kind (`REGION` or `CROSS_REGION`);
- searchable IANA primary timezone dropdown (used for day-configuration resolution);
- location list (many-to-many — Pune hosts AMER, EMEA, APAC people at once);
- **Shifts table** — Name, Code, Timezone, Start, End, Break, computed Net Hours;
- **Shift requirements per day configuration** — immutable code, editable min,
  optional max (`∞` when blank), color picker, remove;
- an inline Add Shift form: code, name, min, color, timezone, times;
- **Day configuration editor** — which weekdays belong to which group, reorderable;
  replacing a unit's complete day configuration is atomic;
- Weekend shifts as tags with minimums, plus Saturday/Sunday timing;
- **Comp-off rules** — window before/after, excluded weekdays, aging threshold,
  approval behavior. There is no expiry setting: comp days do not expire;
- Absence capacity rules — per unit (3 long / 4 short) and per shift pool.

### Managing units

Units are created by the Unit configuration card above (with their shifts, day configurations, etc.). Assigning a person to a unit happens on the People screen, not here.

The day-configuration editor is what makes "Friday has different shifts from
Monday–Thursday" configuration rather than code
([ADR-0016](adr/0016-day-configuration-groups.md)).

### Holidays

Per location and per year. Add, edit, delete, CSV import, and **a preview of which
people and which coverage requirements a change affects** before it is saved.

### Access

The dev identity switcher (stub mode only) picks a **person**, not a role: you get
whatever grants that person holds, which is the only configuration the real product can
produce. To change what somebody can do, change the grant here.

**Settings is an administrator's screen** and the nav hides it from everyone else
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)): every tab on it is configuration, and a
tab that 403s on arrival is worse than no tab. The one setting that was *not* configuration
— which timezone you read the grid in — moved to the profile menu beside the avatar, where
everybody still has it.

Role grants live on **Settings → Roles**: a matrix of people against `Planner`, `Approver`
and `Admin`, filtered by planning unit
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)). Roles are a **set with no ordering** —
an Admin is not thereby a Planner — and each grant names a unit, or is global.

`Viewer` has no column: everyone signed in has it, and a checkbox that can only ever be
ticked is a lie about what is configurable.

Read-only for somebody who does not administer the unit on screen, because "who approves my
leave" is a fair question for the person waiting on the answer. Only a **global** admin can
make a global grant, which is what stops a unit admin promoting themselves out of their
unit; revoking the last global admin is refused.

Self-service is still not a role
([ADR-0046](adr/0046-routing-is-not-authorization.md)): every authenticated person records
their own presence and raises their own requests, and "can I edit my own record" is a
per-resource question.

### Request types

> **Not built as a screen yet.** `RequestType` is an ordinary table with a seeded starting
> set (remote, office, annual leave, other leave, and one per approval-needing event type).
> The mechanism is data-driven exactly so that adding a type is a row rather than a
> deployment ([ADR-0045](adr/0045-generic-request-envelope-typed-materialization.md)) — but
> until this card exists, adding one means editing the seed or the database.
>
> Approval routing is **not** configuration any more and needs no screen: a request goes to
> the `Approver`s of the subject's unit, which are granted on **Settings → Roles**
> ([ADR-0051](adr/0051-roles-are-a-scoped-set.md)).
>
> When it is built, the two things it must not get wrong: a unit with no approvers and no
> admins makes requests un-raisable (the API refuses them with `NO_APPROVER`
> rather than accepting them into limbo), and `materializer` decides whether an approval
> writes anything at all.

### Maintenance

**Global admin only**, and the one tab that does not edit a row — it replaces the whole
system's content ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)). Two buttons, both
outside the dirty-state machinery below, because neither is an edit that can be batched or
cancelled:

**Load demo data** replaces a Bare system with the fixture entire. Offered only while
nobody has added a person or scheduled anything — the fixture carries fixed ids, and
merging it into a system somebody has typed real data into produces a roster nobody can
reason about. When unavailable it is shown **disabled with the reason**, not hidden: a
missing control is indistinguishable from a bug.

**Reset to empty** deletes every location, unit, person, shift and record and hands the
setup wizard back. Confirmed by **typing the environment name**, not by pressing "Yes" — a
confirm dialog for something this destructive is a reflex, and typing is not. It returns
to *migrated and empty*, never a dropped database, so it needs no restart and no rights the
app does not already have.

Both write a history row. Reset is the exception that only logs: it clears
`ChangeHistoryEntry` itself, and a row describing the deletion that deleted it is not a
record.

### Dirty state

The moment configuration differs from the saved snapshot, `Unsaved changes` appears
beside the page title and a sticky bottom bar offers Cancel and Save All. Changed rows
are highlighted. Leaving with unsaved changes prompts Save / Discard / Stay.

**Validation runs before Save All**: duplicate shift codes, invalid time ranges, a
minimum above a maximum, a weekday in two day groups. Invalid configuration stays
dirty and cannot be persisted.

### Effective dating

Coverage-affecting rules are **versioned by effective date**
([ADR-0021](adr/0021-effective-dated-configuration.md)). Saving a change asks from when
it applies, defaulting to today, and creates a new version rather than mutating the old
one. Last March must not turn red because someone raised a minimum today.

Colors, labels and hotkeys are presentation and are not versioned.
