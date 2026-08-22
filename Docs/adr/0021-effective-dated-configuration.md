# ADR-0021. Scheduling configuration is effective-dated

**Status:** accepted

## Context

Coverage is computed by comparing assignments against requirements. Requirements change
— a minimum is raised, a role is added, a day group is reorganized.

If configuration has a single current version, then raising the AMER `Crew` minimum
from 1 to 2 today makes **last March fail retroactively**. March was planned, worked
and closed against a rule that said 1. Reporting it as a gap now is simply false, and
it destroys the value of the historical record: "how often were we short" stops being
answerable if the answer changes every time somebody edits Settings.

The owner's decision: do not touch the past.

## Decision

Coverage-affecting configuration is **versioned with an effective date**:

- `DayConfiguration` and its `RoleRequirement` list;
- `ShiftRole` timing and `countsAsCoverage`;
- `CompOffPolicy` and `AbsenceCapacityRule`.

Coverage for a date resolves the version whose effective range contains that date.
Editing in Settings creates a new version from a chosen effective date; it never
mutates an existing one.

Not versioned: colors, labels, descriptions and hotkeys. These are presentation, they
do not change what was true, and versioning them would produce noise.

## Consequences

- Historical coverage and gap-frequency reports are stable. A number quoted in a
  headcount conversation stays the same next month.
- Settings gains an effective-date control on rule changes, defaulting to "from today".
  The default must be visible, because the most common intent is "from now on".
- The engine takes the date it is evaluating and resolves configuration for it, rather
  than receiving one current configuration. Every coverage call already carries a date,
  so this is a lookup change, not a signature change.
- Fixtures carry one version per configuration, effective from the beginning of time,
  so nothing in development has to care until the feature is exercised.
- **Cost:** every configuration read becomes a date-scoped lookup, and Settings must
  show which version is being edited. This is real work and it is why the alternative
  below was considered seriously.

## Alternatives considered

- **Single current version.** Simplest, and wrong in a way that only shows up months
  later, quietly, in exactly the reports that are used to argue for headcount.
- **Freeze a coverage snapshot at publication** and read history from the snapshot,
  future from current rules. Cheaper — no versioning at all — but it only fixes
  reporting for periods that happened to be published, gives no answer for
  re-evaluating an unpublished past period, and makes "why is this red" unanswerable
  because the rule that produced the snapshot is gone. Rejected as a partial fix that
  costs an entity anyway.
