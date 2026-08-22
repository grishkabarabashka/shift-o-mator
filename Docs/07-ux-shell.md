# Shell, navigation and visual language

## Application shell

Desktop-first. A persistent two-level header above a scrollable page area. **No
permanent left sidebar** — an older sketch had one; navigation, filters and alerts live
in the masthead, the global controls and page cards instead.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Shift-o-mator  [ALL|AMER|EMEA|APAC|ST]  ✏️Draft    ⬤ Name ▾           │  product header
├──────────────────────────────────────────────────────────────────────────┤
│  Overview   Schedule   People   Settings                                 │  masthead
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   page canvas — light gray, white cards                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Product header**, left to right: product identity; segmented **planning unit** selector
— `ALL` plus one segment per unit, so the three regions and any cross-region team such as
Service Transition sit side by side; an amber `✏️ Draft` tag when a draft is open; spacer;
display timezone control (hidden on small screens); user badge with avatar, display name
and role tag.

The user badge opens a popover holding identity (read-only). The display timezone selector
allows viewing times in role time (UTC), or any configured location's timezone. No role
switcher or regional scoping — all users can write everywhere, and the audit trail
provides accountability ([ADR-0020](adr/0020-planning-unit-and-region.md)).

**Masthead:** Overview, Schedule, People, Settings. Active item visually selected.

## Global controls

| Control | Scope | Effect |
|---|---|---|
| Unit selector | Overview, Schedule, People | `ALL` is a global overview; one unit is that unit's roster. **A default filter, not a boundary** — Schedule offers a "whole region" toggle, and everyone can write everywhere. |
| Display timezone | All time-bearing detail (timelines, schedule, people) | Repositions displayed windows to the chosen timezone: role time (the role's fixed window), UTC, or any configured location. Never changes stored definitions. |
| Date range | Overview, Schedule | Back / Today / forward, zoom, presets, clickable day strip, year minimap on long ranges. |
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

Role colors come from regional configuration and are **not decoration**: the same role
keeps the same color in grid cells, People badges, timelines, distribution bars and
settings previews. **A text label always accompanies color** — no state is conveyed by
color alone.

Red and amber are otherwise reserved for coverage and conflict states, so a hole in the
schedule is visible peripherally.

## Widget catalogue

| Widget | Behavior | Used on |
|---|---|---|
| Product header | Identity, switches, segmented selector, tags, user badge | All |
| Masthead nav | Horizontal tabs | All |
| Date-range widget | Prev / Today / next, range label, zoom, presets, day strip, year minimap. Today has a red border; the selected range is blue. | Overview, Schedule |
| Summary statistic | Large number, small label, in one horizontal card. Color shifts on alert. | Overview |
| Alert row | `GAP` or `CONFLICT` badge, region, role, actual vs required | Overview |
| Collapsible region card | Arrow, region name, filled/required, 24h minibar with now marker; expands to timeline detail | Overview |
| Planning grid | Pinned person column, date columns, role chips, pinned coverage rows | Schedule |
| Role chip | Flat full-cell colored badge with the role code; non-working values muted gray | Schedule, People |
| Assignment picker | Floating portal under a cell: eligible Roles, Non-working, Clear | Schedule, draft mode |
| Compact heatmap | Person rows × tiny daily cells grouped by week; sticky names; read-only | Schedule, long ranges |
| People table | Scrollable, selected-row state, role badges | People |
| Person detail panel | Right panel: identity, KPIs, fairness banner, comp-off tiles, role mix, profile | People |
| Settings card | Rows, inputs, dropdowns, switches, tables; changed rows highlighted | Settings |
| Dirty action bar | Sticky bottom bar: unsaved changes, Cancel, Save All | Settings |
| Timeline lane | Region/role row with positioned shift block, gap styling, handover band, now marker | Overview |
| Review overlay | Created / modified / removed totals, scrollable diff, impact summary, Discard and Publish | Schedule, draft mode |
| Error boundary | Page-level fallback preserving global navigation, with retry | All |

## Interaction states

- **Hover** — pale blue or pale gray background; role badges may lift slightly.
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
| No people under filters | "No people match this region/filter" with a Clear filters action |
| No gaps | Hide Attention Required, or show a concise success state. Never an empty alert box. |
| Loading schedule | Preserve card dimensions, skeleton rows, editing and publishing disabled |
| Failed load | Inline error with Retry; state whether cached data is shown |
| Failed publish | **Keep the draft and every change.** Actionable error, retry. |
| Ineligible assignment | Red cell plus an explanation naming the role and the missing eligibility |
| Concurrent change | Published value versus draft value, with Refresh / Reapply. Never a silent overwrite. |
| Cancel draft | Confirmation stating how many changes will be reversed |
| Leaving Settings dirty | Confirm Save, Discard or Stay |
| Auto-populate finds nobody | Leave the gap visible with the reason |
| Comp day has no valid date | `PENDING_APPROVAL`, linked to the earning duty |

## Accessibility and responsive behavior

- Primary editing target is desktop ≥1280px; 1024px remains usable via horizontal
  scroll.
- Below 1024px prioritize read-only Overview and people-focused views. Dense
  editing may be **disabled rather than made unsafe**.
- The grid supports arrow navigation, Enter to open the picker, Escape to close, and
  Ctrl/Cmd+Z to undo.
- Date headers and person names are semantic headers. Role cells carry labels including
  person, date, role and status.
- Coverage changes are announced through a polite live region.
- Popovers manage focus and close on Escape.
- Role chip contrast is computed from the administrator-chosen color; text flips
  between dark and light automatically.
- Motion is subtle and respects reduced-motion preferences.
