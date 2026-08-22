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
| Region | Which rules apply |
| Unit | Whose screen they are planned on |
| Location | |
| Shift | The person's contracted window |
| Days (3mo) | Working days in the last three calendar months |
| Comp-Off | Available balance |
| Eligible Roles | Colored role badges |
| Weekend | Check or dash |

Region and Only Me filters apply. Search matches display name, location and eligible
role code. The footer reports visible versus total included people.

### Person panel

1. Header: name, region tag, shift, close button.
2. Period label: the last three calendar months.
3. KPI strip: Working Days, Weekends, Comp-Off Due.
4. **Fairness banner**: above, below or on target against the regional team average,
   with a ±12% tolerance.
5. **Comp-Off tiles**: Earned, Taken, Pending, Due, and **Aged** — outstanding longer
   than the configured threshold. Comp days never expire; an aged tile is a prompt, not
   a loss. See [05-comp-days.md](05-comp-days.md).
6. **Role Mix**: one row per role with a colored badge, a percentage bar, the
   percentage, the count, and **a marker for the person's `targetShare`** so deviation
   is visible rather than inferred.
7. Expandable **Profile & Configuration**: location, org category, week pattern,
   default entry, weekend eligibility, eligible roles, constraints and preferences.

Selection is read-only. Admin editing is an explicit edit state with Save and Cancel,
and **must never silently alter an open draft**.

### Administration

- Add, edit, deactivate and reactivate people **without deleting assignment history** —
  deactivation removes someone from future planning, nothing else.
- Region and planning unit are set independently: an ST engineer is AMER region,
  Service Transition unit.
- Role-eligibility checkboxes with target shares, default shift, default entry, weekend
  eligibility, `maxWeekendsPerQuarter`, blackout dates and preferred partners.
- History stays attached to the stable person ID.

## Settings — the scheduling model

**User question:** "What rules drive the schedule, and how should the product display
it?"

A vertically scrolling sequence of cards.

### User Preferences

Home region. Display defaults.

### Display Options

Switches: show Off/Leave days, show weekends, highlight coverage gaps, highlight
scheduling conflicts.

### Region configuration

One card per region, each containing:

- editable region name;
- searchable IANA timezone dropdown;
- location list;
- **Shifts table** — Name, Code, Timezone, Start, End, Break, computed Net Hours;
- **one Roles table per day configuration** — immutable code, editable name, min,
  optional max (`∞` when blank), color picker, remove;
- an inline Add Role form: code, name, min, color;
- **Day configuration editor** — which weekdays belong to which group, reorderable;
  replacing a region's complete day configuration is atomic;
- Weekend roles as tags with minimums, plus Saturday/Sunday timing;
- **Comp-off rules** — window before/after, excluded weekdays, aging threshold,
  approval behavior. There is no expiry setting: comp days do not expire;
- Absence capacity rules — region-wide (3 long / 4 short) and per role pool.

### Planning units

Add and edit units: name, kind (`REGION` or `CROSS_REGION`), the region for a region
unit, and the default grid grouping. Assigning a person to a unit happens on the People
screen, not here.

The day-configuration editor is what makes "Friday has different roles from
Monday–Thursday" configuration rather than code
([ADR-0016](adr/0016-day-configuration-groups.md)).

### Holidays

Per location and per year. Add, edit, delete, CSV import, and **a preview of which
people and which coverage requirements a change affects** before it is saved.

### Handovers

Editable time, overlap duration and DST adjustment per season. Historical dates keep
rendering with the rule that applied then.

### Access

Identity-group to app-role mappings: Viewer, Planner, Admin. **No regional scoping**
([ADR-0020](adr/0020-planning-unit-and-region.md)) — a planner may edit any unit. The
control is the audit trail, and this screen links to it.

### Dirty state

The moment configuration differs from the saved snapshot, `Unsaved changes` appears
beside the page title and a sticky bottom bar offers Cancel and Save All. Changed rows
are highlighted. Leaving with unsaved changes prompts Save / Discard / Stay.

**Validation runs before Save All**: duplicate role codes, invalid time ranges, a
minimum above a maximum, a weekday in two day groups. Invalid configuration stays
dirty and cannot be persisted.

### Effective dating

Coverage-affecting rules are **versioned by effective date**
([ADR-0021](adr/0021-effective-dated-configuration.md)). Saving a change asks from when
it applies, defaulting to today, and creates a new version rather than mutating the old
one. Last March must not turn red because someone raised a minimum today.

Colors, labels and hotkeys are presentation and are not versioned.
