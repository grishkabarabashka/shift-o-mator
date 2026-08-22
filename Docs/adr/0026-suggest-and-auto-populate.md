# ADR-0026. Suggest and auto-populate share one candidate ranker

**Status:** accepted — implements the algorithm specified in
[06-generation.md](../06-generation.md)

## Context

06-generation.md already specifies the candidate ordering, the auto-populate
sequence, locking and explainability in detail — it is the design authority
here, not a decision being made fresh. This ADR records the implementation
choices the design doc left open and one correctness fix found while wiring it
up.

## Decision

**One ranking function, two callers.** `engine/candidates.ts` exports
`rankCandidates`, applying the doc's two hard filters (eligibility,
availability) and three soft orderings (90-day fairness, recency, personal
targets) exactly as specified. `Suggest` calls it for one cell. `Auto-populate`
calls it inside a fill loop for every unmet requirement. Neither reimplements
the rule; a change to the ordering changes both at once.

**Auto-populate is two passes, not one rule list.** Pass A places each
included person's `defaultRoleId` on their ordinary working days — that
answer comes from the person's profile, not from ranking. Pass B fills
whatever Pass A left under minimum, using `rankCandidates`. Folding these into
one pass would mean either defaults get ranked (and "whose job is this"
stops being predictable) or ranked fills inherit default priority (and
specialist roles start going to whoever merely has the lowest count, not
whoever it's actually for).

**Never touches an occupied or locked cell.** Occupied means any existing
assignment record — role, marker, or otherwise; that is a decision already
made. A cell is locked via a menu item on any role assignment, stored as a
session-only `Set<AssignmentId>` in `useUi` (not plan data — a lock is a
working note for this generation run, not a fact about the schedule worth
publishing or keeping in history).

**The result is a preview**, per spec: `autoPopulate` is a pure function
returning `DraftChange[]` plus a `gaps` list with a stated reason, never
touching the store. `AutoPopulateDialog` runs it synchronously against the
current plan, shows counts and gap reasons, and only on explicit Accept does
`commitAutoPopulate` open a draft if needed and re-sequence the changes
through the store's own `nextSeq()` — the preview's internal counter cannot be
reused as-is, or a manual edit made between preview and accept could get a
`seq` earlier than generated changes that logically preceded it, corrupting
undo order.

**Deterministic IDs.** Generated assignments use `as-gen-${date}-${personId}`
rather than a timestamp. Re-running generation on an unchanged range produces
byte-identical output, which the doc requires ("a planner who reruns
generation after a small edit must not see the whole month reshuffle") and
which a random ID would quietly violate.

## A bug the tests found: busy is not the same as ineligible

Candidates already assigned elsewhere that day are excluded from a role's
candidate list (`excludePersonIds`, the "no conflicting duty" hard filter).
The first version dropped them silently — no entry in `excluded`, no reason
in the gap.

Where a role has exactly one eligible person and that person is already
working something else, the gap message read **"No one in this region is
eligible for this role."** That is false, and it is the specific failure mode
06-generation.md warns against: *"the list explains why the gap cannot be
closed... rather than showing an empty box."* An empty box with a wrong label
is worse than an empty box.

Fixed: busy-elsewhere candidates are pushed into `excluded` with reason
`"already assigned to something else that day"`. A real run against the AMER
fixtures changed the message from a false negative to `"8 eligible, 8 already
assigned to something else that day"` — which is what a planner needs to
decide whether to loosen coverage elsewhere, not a claim that the role has no
one qualified at all.

## Consequences

- Suggest and auto-populate cannot silently drift apart in what counts as a
  valid candidate — there is one function, not two copies.
- The lock icon and menu item only appear on cells holding a role assignment;
  an empty cell needs no lock because generation never fills what already has
  a marker or nothing to overwrite in the first place — it only fills gaps.
- Auto-populate is capped at `AUTO_POPULATE_MAX_DAYS` (92), checked in the
  dialog before the engine runs, matching the prototype's backend limit.
- Comp days for weekend/holiday work created during generation are proposed
  through the existing `proposeCompDays`, scoped to just-generated assignment
  IDs — the same scoping fix from the manual-edit path, applied here so one
  Accept does not attribute the whole period's unprocessed weekends to the
  planner running Generate.

## Alternatives considered

- **Hide busy-elsewhere people from `excluded` but change the gap-reason
  wording to hedge** ("may not be available"). Rejected: it still discards
  information the planner would act on differently (busy vs. genuinely
  unqualified), and hedged language reads as noise after the second gap.
- **Random/timestamp assignment IDs**, matching the manual-edit path's
  `as-local-${Date.now()}...`. Rejected specifically for generation, where
  determinism is a named requirement; the manual path has no such requirement
  since a human is choosing each time.
