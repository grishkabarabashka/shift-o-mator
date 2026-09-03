# Shell, navigation and visual language

## Application shell

Desktop-first. A persistent two-level header above a scrollable page area. **No
permanent left sidebar** — an older sketch had one; navigation, filters and alerts live
in the masthead, the global controls and page cards instead.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Shift-o-mator  [Units ▾]  ✏️Draft  🕐 clocks  🔔  ⬤ Name ▾            │  product header
├──────────────────────────────────────────────────────────────────────────┤
│  Overview  Schedule  People  My calendar  Requests  Settings             │  masthead
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   page canvas — light gray, white cards                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Product header**, left to right: product identity; the **planning unit** picker — a
checkbox popover holding `All planning units` plus every unit, so a planner who runs AMER
together with Service Transition selects exactly those two (a unit is a filter, not a
boundary — ADR-0032 — and "all or one" answered the wrong question); an amber `✏️ Draft`
tag when a draft is open; spacer; absence-freshness note; a **read-only strip of location
clocks** (hidden on small screens); the **notification bell**
([ADR-0044](adr/0044-in-app-inbox-first.md)); user badge with avatar, display name and
access role.

The user badge opens a popover holding identity (read-only), and a **Display** control
beside it holds the timezone choice. It is not in the header itself — the header shows the
clocks, and choosing a zone is a preference set once — and it is not in Settings either,
because Settings is admin-only and everybody needs this one
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)).

Writes **are** scoped to a planning unit since ADR-0051, with a global grant for the
planner who genuinely covers everywhere; the audit trail still provides accountability
([ADR-0032](adr/0032-planning-unit-single-rule-axis.md), made real by
[ADR-0039](adr/0039-actor-identity-from-the-token.md)).

**Masthead:** Overview, Schedule, People, My calendar (`/me`), Requests, Settings. Active
item visually selected. **Settings is hidden from anyone who administers nothing**
([ADR-0051](adr/0051-roles-are-a-scoped-set.md)) — a tab that 403s on arrival is worse
than no tab. Requests and My calendar sit in the main nav rather than behind a menu
because they are the screens most of the eighty people ever need
([ADR-0047](adr/0047-absorb-the-self-service-portal.md)).

### What runs before the shell

Three gates, in this order, and the order is the point:

1. **`EntraGate`** (`VITE_AUTH_MODE=entra`) — MSAL, redirect flow, `sessionStorage`.
   It installs a token provider into `api/client.ts` via `setAccessTokenProvider`:
   **injected, never imported**, because MSAL lives in `auth/`, which sits *above* `api/`
   in the layering ([ADR-0058](adr/0058-entra-id-identity-is-linked-by-email.md)).
2. **`SetupGate`** — a system with no `SystemSetup` row answers `503 SETUP_REQUIRED` to
   everything, and this is the wizard that fixes it: **Bare** or **Demo**
   ([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)). It sits *after* sign-in outside
   stub mode, because Bare takes the first admin from the caller's own token claims.
3. **`AuthProvider`** — asks the **server** who it is (`GET /api/auth/me` →
   `useSchedule.setCurrentUser`). It used to guess ("the first MANAGEMENT person in scope"),
   and that guess disagreed with both `/api/auth/me` and the audit trail. Never reintroduce
   a client-side identity heuristic.

Nothing checks the client's `VITE_AUTH_MODE` against the server's `Auth:Mode`. Mismatched,
either the token is ignored or none is sent — the two halves must be switched together.

## Global controls

| Control | Scope | Effect |
|---|---|---|
| Unit picker | Overview, Schedule, People | `ALL`, one unit, or any subset. **A default filter, not a permission boundary** — but write access *is* scoped to a unit since [ADR-0051](adr/0051-roles-are-a-scoped-set.md), so seeing a unit and being able to edit it are separate questions. With more than one unit on screen the Schedule grid groups by unit first, then by the unit's own grouping, so two cities of the same name from different units cannot be confused. |
| Display timezone | All time-bearing detail (timelines, schedule, people) | Set in the **Display** menu beside the avatar. Repositions displayed windows to the chosen timezone: shift time (the shift's fixed window), UTC, or any configured location. Never changes stored definitions. |
| Date range | Overview, Schedule | Back / Today / forward and zoom. **Overview and Schedule hold independent periods** ([ADR-0036](adr/0036-overview-and-schedule-independent-periods.md)): Overview is a 1/3/7-day window; Schedule is month / 2 months / quarter / half-year, running **forward from the selected day** rather than snapped to a calendar month. `‹ ›` step one day, `« »` one month. The day strip and year scrubber move the anchor; they no longer build an arbitrary custom range. |
| Display options | Schedule | Show or hide off days and weekends; toggle gap and conflict emphasis. |

**Filters survive navigation within a session.** Jumping from an Overview gap to
Schedule must not silently change unit or date. Deep links carry unit and date so a gap
can be shared.

## Visual language

Dense but restrained — an operational console, not a dashboard product.

- System typography; 14px body, 22px semibold page titles, 12–13px table text.
- Compact 26px grid rows.
- White cards on a light-gray canvas; pale gray dividers; ~8px corner radius.
- Hovered rows very light blue; selected rows a stronger pale blue.
- 20px vertical / 24px horizontal page padding.

Color carries fixed meaning:

| Color | Meaning |
|---|---|
| Green | Requirement met, valid balance, success |
| Amber | Attention: thin coverage, pending item, unsaved configuration |
| Red | Gap, conflict, expired item |
| Blue | Selection, current range, general interaction |
| Gray | Non-working state, neutral metadata, unavailable action |

Shift colors come from the unit's configuration and are **not decoration**: the same
shift keeps the same color in grid cells, People badges, timelines, distribution bars and
settings previews. **A text label always accompanies color** — no state is conveyed by
color alone. The presence glyph
([ADR-0043](adr/0043-presence-is-an-orthogonal-range-entity.md)) follows the same rule:
it is a letter, not a hue, and its meaning is spelled out in the cell's tooltip and
`aria-label`.

Red and amber are otherwise reserved for coverage and conflict states, so a hole in the
schedule is visible peripherally.

### Elevation, measure and the type scale

The rules above describe *colour*. The rules that give a screen **hierarchy** are
[ADR-0057](adr/0057-a-language-of-surfaces.md), and they are what stops every surface
carrying the same weight:

- **Elevation is a ladder of five** (`--elev-0` … `--elev-4`) with one rule that makes it
  mean anything: **exactly one surface per screen sits on `--elev-2`** — the one the screen
  exists for (the grid on Schedule, the timeline on Overview, the months on My calendar).
  Everything else rests at 1 or below; 3 and 4 float above the page.
- **Dark mode inverts the mechanism, not the values.** A drop shadow on a `#0b0e13` canvas
  is invisible because there is no light for it to block, so every rung leads with a lit top
  edge and the shadow only deepens the separation beneath.
- **Only the planning grid is full-bleed.** My calendar is `clamp(340px, 40vw, 560px)` and
  centred; Requests caps at 880px. The grid keeps the whole width and earns it — eighty rows
  and a horizontal axis — and reads as *the instrument* precisely because it is the only
  screen that does.
- **One page header and one scale.** `ui/PageHeader.tsx` is `h1` + one line of context + a
  slot for actions. The type scale is `--fs-*` in `:root`, exported to Tailwind's `text-*`
  family from `@theme inline` under **different names**: a `@theme` entry referencing a
  `:root` property of its own name is a circular reference that silently resolves to
  nothing.
- **Focus mode drains saturation, and nothing else.** While a draft is open the chrome
  desaturates; nothing moves, collapses or becomes unreachable. The issue panel stays at
  full strength — it is what the planner is editing against — and the draft pill is exempt,
  because dimming the indicator for the mode is a joke the user does not get to be in on.

### The sky is a separate colour family

The header clocks carry the state of their own sky — night deep and cold, dawn and dusk
warm, daytime light — computed by `skyPhase`, which lives beside `nightBands` and shares its
constants so the header and Overview's axis cannot disagree about what night is.

`--sky-*` is deliberately **not** part of the semantic palette above. A warm sunset drawn in
`--warn` would read as a warning about Chicago. Sky colours appear nowhere a semantic colour
can, and the sky never carries anything alone: the phase is named in the `title`, and the
selected zone is marked by a ring and a lift rather than a wash of accent, so choosing
London does not paint over the fact that it is night there.

This is not astronomy and must not become one. `skyPhase` knows neither latitude nor season:
a solar calculation would put sunrise in Reykjavik at 03:00 in June, which tells a planner
in Chicago nothing they can use.

### Success has a channel, and failure keeps its own

Failure had three surfaces — the Schedule banner, the "Not saved — retrying" pill, the
`beforeunload` guard — and success had none, so publishing, approving and saving settings
were confirmed only by something disappearing, which is indistinguishable from never having
been sent. `ui/toasts.ts` plus one `ToastViewport`: `role="status"` for success,
`role="alert"` for failure — before this the app had **no live region anywhere**.

It does not replace the three failure surfaces. A failed publish keeps its banner, because
that message belongs beside the draft it is about, and field errors stay at their fields;
the toast reports the outcome of the batch. **Toasts are raised from `features`, never from
`store`** — the layering runs downward, and `store` reaching up into `ui` would be the first
edge going the wrong way.

## Widget catalogue

| Widget | Behavior | Used on |
|---|---|---|
| Product header | Identity, unit picker, clocks, notification bell, tags, user badge | All |
| Masthead nav | Horizontal tabs | All |
| Date-range widget | Prev / Today / next, range label, zoom, day strip, year scrubber. Today has a red border; the selected range is blue. | Overview, Schedule |
| Summary statistic | Large number, small label, in one horizontal card. Color shifts on alert. | Overview |
| Alert row | `GAP` or `CONFLICT` badge, unit, shift, actual vs required | Overview |
| Collapsible unit card | Arrow, unit name, filled/required, 24h minibar with now marker; expands to timeline detail | Overview |
| Notification bell | Unread count, popover list, deep link to the subject, mark-all-read | All |
| Planning grid | Pinned person column, date columns, shift chips, pinned coverage rows | Schedule |
| Shift chip | Flat full-cell colored badge with the shift code; non-working values muted gray | Schedule, People |
| Absence fill | The event type's colour behind the whole cell — half of it for a half-day, on the side it falls (ADR-0052) | Schedule |
| Presence band | Letter in a strip along the bottom of the cell, coloured by kind; quieter when it matches the person's baseline | Schedule |
| Assignment picker | Floating portal under a cell: eligible shifts, self-service (presence and time off), history. Opens on right-click, Shift+F10 or the Menu key | Schedule |
| Settings tab | Hidden from anyone who administers nothing — every tab on it is configuration (ADR-0051) | — |
| Day menu | Right-click on a date header: that day's history, for everybody | Schedule |
| Request row | Type, dates, state pill, approver actions | Requests |
| Compact heatmap | Person rows × tiny daily cells grouped by week; sticky names; read-only | Schedule, long ranges |
| People table | Scrollable, selected-row state, shift badges | People |
| Person detail panel | Right panel: identity, KPIs, fairness banner, comp-off tiles, shift mix, profile | People |
| Settings card | Rows, inputs, dropdowns, switches, tables; changed rows highlighted | Settings |
| Dirty action bar | Sticky bottom bar: unsaved changes, Cancel, Save All | Settings |
| Timeline lane | Unit/shift row with positioned shift block, gap styling, handover band, now marker | Overview |
| Review overlay | Created / modified / removed totals, scrollable diff, impact summary, Discard and Publish | Schedule, draft mode |
| Error boundary | Page-level fallback preserving global navigation, with retry | All |

## Interaction states

- **Hover** — pale blue or pale gray background; shift badges may lift slightly.
- **Focus** — always a visible blue outline, including grid cells. Never suppressed.
- **Selected** — pale blue rows; blue fill on the active range and zoom button.
- **Disabled** — lower contrast, no response. Save and Undo are disabled with no
  changes.
- **Changed** — settings rows highlighted; **draft cells are visually distinct from
  published cells**.
- **Error / conflict** — red border or background *plus* text. Color is never enough.
- **Loading** — keep page structure, show skeletons, disable destructive actions.
- **Empty** — explain why there is nothing and offer the next valid action.

## Empty, loading and error behavior

| Situation | Required behavior |
|---|---|
| No assignments in range | Keep the people/date structure, show empty cells and red requirements, say "No assignments scheduled", offer Edit to planners |
| No people under filters | "No people match this unit scope" with a Clear filters action |
| No gaps | Hide Attention Required, or show a concise success state. Never an empty alert box. |
| Loading schedule | Preserve card dimensions, skeleton rows, editing and publishing disabled |
| Failed load | Inline error with Retry; state whether cached data is shown |
| Failed publish | **Keep the draft and every change.** Actionable error, retry. |
| Ineligible assignment | Red cell plus an explanation naming the shift and the missing eligibility |
| Concurrent change | Published value versus draft value, with Refresh / Reapply. Never a silent overwrite. |
| Cancel draft | Confirmation stating how many changes will be reversed |
| Leaving Settings dirty | Confirm Save, Discard or Stay |
| Auto-populate finds nobody | Leave the gap visible with the reason |
| Comp day has no valid date | `PENDING_APPROVAL`, linked to the earning duty |

## Accessibility and responsive behavior

- Primary editing target is desktop ≥1280px; 1024px remains usable via horizontal
  scroll.
- **Narrow viewports get a different control, never a missing one**
  ([ADR-0057](adr/0057-a-language-of-surfaces.md)): the clock strip collapses to one clock
  plus a popover, the issue panel becomes a drawer, My calendar stacks. These use
  `useMediaQuery` rather than a Tailwind breakpoint, because rendering both and hiding one
  would mount two issue panels with two scroll positions fighting over one piece of state.
- **What is still missing is touch, not layout.** There are no touch or pointer handlers
  anywhere, so painting, range selection and the year scrubber are mouse-only. A phone can
  read this product and cannot plan with it.
- The grid supports arrow navigation, **Shift+F10 or the Menu key** to open the picker,
  Escape to close, and Ctrl/Cmd+Z to undo. **Tab leaves the grid** — it is deliberately
  not bound to cell movement, which used to make the grid a keyboard trap with no way out.
- The grid is a valid ARIA grid: `role="row"` wrappers (`display: contents`, so the CSS
  grid layout is unaffected), `rowheader` person names, `columnheader` dates,
  `aria-selected` on cells, and `aria-activedescendant` on the scroller, since DOM focus
  stays there and a virtual cursor moves.
- Date headers and person names are semantic headers. Cells carry an `aria-label`
  including person, date, shift, status, any issue and any presence mark — everything the
  tooltip says, since `title` is unreachable without a pointer.
- Coverage changes are announced through a polite live region.
- Popovers manage focus and close on Escape.
- Shift chip contrast is computed from the administrator-chosen color; text flips
  between dark and light automatically.
- Motion is subtle and respects reduced-motion preferences.
