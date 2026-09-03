# Rotation, suggestions and auto-generation

Three related capabilities on one engine: rank candidates for a shift on a date, fill
one gap, or fill a whole period.

## Candidate ordering

The ordering below comes from the validated prototype and is the shared basis for
Suggest and Auto-populate:

1. **Eligibility** — the shift is in the person's eligibility list.
2. **Availability** — not on leave, not a confirmed comp day, not a blackout date, the
   weekday is in their availability, and they hold no conflicting duty that day.
3. **Fairness over 90 days** — fewest assignments of this shift in the trailing 90 days
   first.
4. **Recency** — the most recent holder of this shift is pushed down.
5. **Personal targets** — `maxWeekendsPerQuarter` and `maxPerWeek` push a person down
   or out.

Steps 1 and 2 are hard filters. Steps 3–5 are ordering.

**Target share as the fairness metric.** Raw counts treat everyone as
interchangeable, which is wrong when qualification differs
([ADR-0006](adr/0006-eligibility-target-shares.md)). The displayed fairness figure is
the deviation of actual share from `targetShare`; the candidate ordering uses the
prototype's counts because they are what planners recognize. Both are shown in the
suggestion list so the ranking can be argued with.

## Suggest — fix one gap

A coverage cell in the `GAP` state exposes a Suggest action. It opens a ranked
candidate list showing, per candidate: name, shift count in the last 90 days, days since
they last held the shift, weekend load against target, and any warning that would be
created by choosing them.

Choosing a candidate **stages a draft change**. It never publishes.

If no candidate passes the hard filters, the list explains why the gap cannot be
closed — "3 eligible, all on leave" — rather than showing an empty box.

## Auto-populate — fill a period

Constraints:

- one unit, one period, at most **92 days**;
- runs into a draft, never into published data;
- **locked cells are never touched** — the planner locks the assignments they have
  already decided, and generation receives those IDs.

Sequence:

1. load the day configuration for each date in the period;
2. **minimums first** — fill every requirement to its `min` by the candidate ordering,
   including weekend and holiday duty;
3. **then personal defaults** — a person carrying an explicit `defaultShiftId` gets it,
   if the day offers that shift and it has room. An exception mechanism (ADR-0038), not
   the norm: almost nobody has one;
4. **then top up** — on ordinary working days only, keep filling requirements towards
   `max` by the candidate ordering;
5. **then the day's bulk shift** — the requirement marked `isDefault` with no `max`
   takes everyone still free and eligible;
6. generate comp days for the weekend and holiday work just created;
7. return the ordered set of draft changes.

**Where the team goes on an ordinary day is a property of the day, not of each person**
([ADR-0038](adr/0038-day-configuration-owns-the-default-shift.md)). Engineers do not
carry a default shift; they carry the shifts they cannot do. A unit that declares no bulk
shift for its ordinary days fills them only to their minimums.

**Every pass that takes people in bulk runs after every pass that needs a particular
person**, because the scarce resource is not the shift, it is somebody free to work it.
The same mistake is available twice: defaults used to run before minimums, and a unit
where everyone carried `Crew` had its whole team consumed before minimums were
considered — every specialist shift then reported "24 eligible, all already assigned to
something else that day". The bulk pass would repeat it one floor down, since
`AMER:Crew` sorts alphabetically before `AMER:Crew-BC` and `AMER:Lead`.

**Top-up is what fills a day whose shifts have ceilings.** unit-amer's Friday
carries `Lead-E` / `Crew-E` / `Crew-L`, which no one has as a default; without a pass
that fills past the minimum, Friday got exactly one person per shift and read as empty.
A `max` of null means unlimited and is *not* a top-up target: an unlimited requirement
is claimed by the bulk pass, and only when the configuration marks it `isDefault`.

Weekend and holiday configurations get their minimums and nothing more: they are duty
rosters, and filling them to capacity would invent weekend work — and the comp days that
come with it.

Generation reads published data **plus the planner's open draft** (`draftId` on the
request). Without it, cells filled by hand minutes earlier look empty to the generator,
and accepting the preview overwrites the decision that was just made.

Where a requirement cannot be met, generation leaves a **visible gap with a stated
reason**. Silently under-filling is worse than an honest hole.

**Selecting cells first scopes the run** (owner review — Generate otherwise always
filled the whole visible period). The `/api/auto-populate` endpoint itself has no
person filter; it still fills the whole unit for the given range. The client narrows
range to the selection's earliest–latest date and drops every previewed change for a
person outside the selection before it can reach the draft (`AutoPopulateDialog.tsx`,
`autoPopulateScope.ts`) — nothing changes on the server for this. Gaps stay unit-wide
in the preview even when scoped to a few people, since a gap has no person to filter
by.

## Plain-English explanations (optional)

The rule for every AI surface, stated once ([ADR-0048](adr/0048-ai-explains-the-plan-never-decides-it.md)):

> **A deterministic function computes the answer. The model only phrases it.** If the
> digest is wrong the summary is wrong no matter how it is generated — so the digest is
> what gets tested, and the model is never given the chance to reason about raw data.

The model never writes. Nothing here touches published data, opens a draft or ranks
anybody.

### Gap summary

`POST /api/insights/gap-summary` explains a period's gaps, conflicts and warnings in a
few sentences. Two layers, deliberately separate:

- `IssueDigest` (Application, pure, tested) groups the validator's output by shift,
  level and code, and counts it. This is where correctness lives.
- `GapSummaryService` (Api) asks a model to phrase that digest, under a prompt that
  forbids any number, name, date or cause the digest does not contain.

The response carries the validator's counts alongside the prose, and the UI shows both,
so a reader can check one against the other.

Which model answers is configuration, not code: the service talks to `IChatClient`
(Microsoft.Extensions.AI), and the `Ai` section names the provider and model
(`"Provider": "azure-openai" | "openai" | "none"`), with `Ai:Endpoint` naming the resource
or gateway. The sandbox and production both use an Azure OpenAI deployment, which needs no
key at all because the app authenticates as itself; locally it is off unless switched on
(ADR-0060, and `deploy/README.md` section 2b). With nothing configured the endpoint answers `503 AI_NOT_CONFIGURED` and the
panel does not appear. Nothing in planning depends on it — the model explains the plan,
it never decides it.

### Why this candidate

`POST /api/insights/candidate-explanation` answers the question the suggestion popover
raises: *why is this person first?*

`CandidateDigest` (Application, pure, tested) computes the **deciding factor** by reading
the ranker's own ordering — eligibility, availability, fewest in 90 days, recency,
warnings, id — and naming the first criterion on which the leader and the runner-up
differ. That is the honest reason, as opposed to whichever number looks largest.

Two properties follow, and both matter:

- **It answers without a model.** The deciding factor and the digest are always present;
  only the phrased sentence is conditional. A deployment with no model access still gets
  the real answer.
- **It refuses to invent one.** When every measured criterion ties, the deciding factor is
  literally *"tied with the others on every fairness measure — the order here is
  arbitrary"*, and the prompt is told to say so plainly. A planner is about to justify a
  rota decision with this sentence.

## Explainability

Every generated assignment can explain itself:

> Person 06 assigned Saturday 15 Aug as Primary: 3 weekend shifts in the last 12 weeks
> against a team average of 4.2. Alternatives: Person 07 (would exceed 2 weekends per
> quarter), Person 08 (on leave 12–19 Aug).

Without this, planners stop trusting auto-generation within a month and go back to
doing it by hand. Explainability is not a nice-to-have; it is what makes the feature
survive contact with users.

## Preview and acceptance

The result is a **preview**, accepted or rejected as a whole or day by day. Individual
people can be frozen from re-planning. Accepting stages draft changes, which then go
through the normal review and publish flow.

## Determinism

The algorithm is greedy construction plus local search over a penalty sum, with a
deterministic seed: the same inputs produce the same schedule. A planner who reruns
generation after a small edit must not see the whole month reshuffle.

If a solver library (OR-Tools CP-SAT or equivalent) is available in the target
environment, prefer it — the problem is small and solves in a fraction of a second. The
interface is the same either way ([ADR-0012](adr/0012-schedule-repository-boundary.md)).

> **One trade to weigh before swapping.** A solver optimises globally and therefore cannot
> say *why* a particular person got a particular cell in terms anyone can check. The greedy
> ranker can — that is what `CandidateDigest`'s deciding factor reads off. Optimality would
> cost the explanation, and the explanation is what a planner defends a rota with.

## When to build it

Not before two or three months of real data exist. Fairness computed over an empty
history is noise, and a generator that suggests nonsense on its first run does not get
a second one. See [13-roadmap.md](13-roadmap.md).
