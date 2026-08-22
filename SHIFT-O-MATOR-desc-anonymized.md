# Shift-O-Mator — Product, UX, Data and Rebuild Specification

**Primary purpose:** describe what Shift-O-Mator is, what users see, how they work with it, which information the product manages, and how that information is connected.
**Secondary purpose:** preserve technical, deployment and implementation details. Product behavior, workflows, UI/UX and data meaning take precedence over technology choices.

**Evidence:** this document consolidates the running frontend, source code, design documents and representative scheduling-workbook structures. Examples use generic people, identifiers and scheduling patterns. Statements marked **Current** describe behavior visible in the present code. Statements marked **Target** describe documented product behavior that is incomplete or not yet connected.

**Sanitization:** this specification is intended to contain no personal data, company name, company-specific employee identifiers, credentials, private URLs or production environment values. All people are labeled `Person 01`, `Person 02`, and so on. Hosts and identity values are placeholders only.

**Consolidation policy:** all durable product, UX, data, API, security, testing and deployment requirements from the Markdown documents under `docs/` are incorporated here. Sprint tables, completion icons, duplicated command lists and unsafe example identities/hosts are not copied verbatim. Where a design document differs from the running code, this specification states both **Current** and **Target** behavior; current source code wins when describing what exists today.

---

## 1. Product and operating model

### 1.1 What the product is

Shift-O-Mator is a shared planning and coverage portal for a multi-region application-support organization. The team operates across APAC, EMEA and AMER, with staff in multiple locations and time zones. People have different working patterns and qualifications. Each day requires particular operational roles, and those requirements change by region, weekday, Friday, weekend and public holiday.

The product replaces several spreadsheet views with one consistent model:

- a people-by-day schedule;
- role requirements and coverage health;
- weekend and specialist rotations;
- live regional coverage across time zones;
- weekend-work-to-comp-off links;
- public-holiday staffing;
- people eligibility, availability and fairness statistics;
- configurable shifts, timings, colors and handovers;
- planner drafts and controlled publication; and
- a traceable history of schedule changes.

The central object is an **assignment**: one person, on one calendar date, with one role or non-working status. Assignments are displayed in a calendar grid, interpreted against regional requirements, and converted into coverage information.

### 1.2 Product goals

1. Anyone can answer “who is working, where, and in which role?” without opening several spreadsheets.
2. A planner can create a schedule without accidentally changing the published rota.
3. Missing coverage and invalid assignments are visible while planning, not after publication.
4. Weekend and specialist duties are distributed fairly among eligible people.
5. Comp-off earned by weekend work is visible, linked and auditable.
6. A global user can view the same shifts in a chosen display time zone.
7. Regional patterns remain configurable; they are not hard-coded into the visual design.
8. Historical spreadsheet patterns can be represented without losing distinctions such as `0`, `Off`, `PH`, `Comp-Off`, on-call, training and sickness.

### 1.3 Users and access

| User             | What they need                                                   | Product behavior                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewer           | Understand current and future coverage and find personal duties. | Reads published data, filters to “Only Me,” changes display time zone, browses Dashboard, Schedule and People. Cannot alter the published plan.                                                           |
| Regional planner | Build and maintain a valid rota for a region.                    | Enters draft mode, assigns eligible roles, marks non-working statuses, checks gaps, undoes changes, generates suggestions, reviews and publishes. Region scope limits editable data.                      |
| Administrator    | Maintain the scheduling model and exceptional access.            | Manages people, qualifications, shifts, role requirements, colors, holidays, comp-off rules, handovers and role mappings. Can work across all regions and force publication only when explicitly allowed. |

Role switching currently visible in the user menu is a development convenience. In the target product, role and regional scope come from authenticated access rules.

### 1.4 Core vocabulary

| Term               | Meaning to the user                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Published schedule | The authoritative rota visible to all users.                                                       |
| Draft              | A private set of proposed changes owned by a planner for a region and week.                        |
| Role               | Work performed that day, such as `Lead`, `Crew`, `M`, `E`, `BM` or `Primary`.                      |
| Status             | A non-working or exceptional state such as `Off`, `PH`, `Comp-Off`, `Leave`, `Training` or `sick`. |
| Requirement        | Minimum and optional maximum number of people needed for a role on a type of day.                  |
| Coverage           | Comparison of actual role assignments with requirements.                                           |
| Gap                | Fewer eligible assignments than the role minimum.                                                  |
| Conflict           | Invalid data such as ineligible role, duplicate assignment or invalid comp-off placement.          |
| Thin coverage      | Minimum is met but there is little or no spare capacity.                                           |
| Handover           | Configured transition from one region’s operational window to the next.                            |
| Comp-off           | A compensatory non-working day earned from weekend or holiday work.                                |
| Rotation           | Fair ordering of eligible people for specialist or weekend work.                                   |

---

## 2. Information architecture and navigation

### 2.1 Application shell

The product is desktop-first and uses a persistent two-level header above a scrollable page area.

**Top product header, left to right:**

1. product identity: `Shift-O-Mator`;
2. **Only Me** switch, affecting people and schedule views;
3. segmented region selector with `ALL`, `AMER`, `EMEA`, `APAC`;
4. amber/tip-style `✏️ Draft` tag when edit mode is active;
5. flexible spacer;
6. user badge with user icon, display name and role tag.

Selecting the user badge opens a floating popover. **Current:** it contains a development role switcher and a display-time-zone dropdown. The popover closes on outside click. **Target:** role switching is removed for ordinary users; identity/access are read-only, while the display-time-zone control remains.

**Second-level masthead navigation:** Dashboard, Schedule, People and Settings. The active item is visually selected. There is no permanent left sidebar in the current UI, despite an older design sketch mentioning one.

**Page canvas:** light-gray application background with 20px vertical and 24px horizontal padding. Pages use white cards, subtle gray borders and approximately 8px corner radius.

### 2.2 Global controls and their scope

| Control            | Scope                                      | Expected effect                                                                                                    |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Only Me            | All person/assignment views                | Restricts data to the signed-in person. Useful for answering “what am I doing?”                                    |
| Region selector    | Dashboard, Schedule and People             | `ALL` shows a global overview; a single region enables region-specific requirements and grouped planning behavior. |
| Display timezone   | Dashboard timelines and time-based details | Repositions displayed work windows without changing stored local shift definitions.                                |
| Date-range control | Dashboard and Schedule                     | Moves backward/forward, returns to today, changes zoom and selects a visible period.                               |
| Display options    | Schedule                                   | Shows/hides off days and weekends and toggles gap/conflict emphasis.                                               |

Filters must survive navigation during a session so that moving from a Dashboard gap to Schedule does not unexpectedly change region or date context.

---

## 3. Visual language and reusable widgets

### 3.1 Overall appearance

The interface is dense but restrained, designed for operational use rather than marketing. It uses system typography (San Francisco/Segoe UI/Roboto fallback), 14px body text, 22px semibold page titles, 12–13px table text and compact 26px grid rows. White cards sit on a light-gray page. Dividers are pale gray. Hovered rows use a very light blue; selected rows use a stronger pale blue.

Information color has consistent meaning:

- green: requirement met, valid balance or success;
- amber/orange: attention, thin coverage, pending item or unsaved configuration;
- red: gap, conflict, expired item or today marker where configured;
- blue: selection, current range and general interaction;
- gray: non-working state, neutral metadata or unavailable action.

Role colors come from regional configuration. They are not only decoration: the same role should keep the same color in schedule cells, People role badges, timelines and configuration previews. Text labels always accompany color.

### 3.2 Widget catalogue

| Widget                     | Appearance and behavior                                                                                                                                                                            | Used on                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Product header             | Shared application header with title, switches, segmented selector, tags and user badge.                                                                                                           | All pages                |
| Masthead navigation        | Horizontal tabs immediately under header.                                                                                                                                                          | All pages                |
| Date-range widget          | White bordered card with previous/today/next controls, range label, zoom buttons, presets, clickable day strip and yearly minimap for long ranges. Today has a red border; selected range is blue. | Dashboard, Schedule      |
| Summary statistic          | Large number with small label, arranged in one horizontal white card. Number changes color for success/alert.                                                                                      | Dashboard, timelines     |
| Alert row                  | Compact row with `GAP` or `CONFLICT` badge, region, role and actual-versus-required text.                                                                                                          | Dashboard                |
| Collapsible region card    | Header with arrow, region name, filled/required value and 24-hour minibar containing shift window and now marker. Expands into timeline detail.                                                    | Dashboard                |
| Planning grid              | AG Grid with pinned person column, date columns, role chips and pinned Coverage row.                                                                                                               | Schedule                 |
| Role chip                  | Flat, full-cell colored badge with role code. Non-working values use muted gray styling.                                                                                                           | Schedule, People         |
| Assignment picker          | Floating portal dropdown under a cell. Sections: eligible Roles, Non-working, and Clear when populated. Each role shows color, code and long name.                                                 | Schedule draft mode      |
| Compact heatmap            | Person rows × tiny daily colored cells grouped into weeks; sticky names and scrolling. Read-only for 3/6-month views.                                                                              | Schedule                 |
| Search field               | 260px search input matching name, location or eligible role.                                                                                                                                       | People                   |
| People table               | Scrollable table with selected-row state and role badges.                                                                                                                                          | People                   |
| Person detail drawer/panel | Fixed-width right panel with close button, identity header, KPIs, fairness banner, comp-off tiles, role-distribution bars and expandable profile.                                                  | People                   |
| Settings card              | White bordered section containing rows, inputs, dropdowns, switches or tables. Changed rows are highlighted.                                                                                       | Settings                 |
| Dirty-action bar           | Sticky bottom bar stating unsaved changes with Cancel and Save All Changes.                                                                                                                        | Settings                 |
| Timeline lane              | Region/role row with positioned shift block, gap styling, handover band and current-time marker.                                                                                                   | Dashboard timeline       |
| Tag                        | Small neutral/status pill for roles, region, draft state or weekend roles.                                                                                                                         | Header, People, Settings |
| Review changes overlay     | Small modal/overlay with created, modified and removed totals; a scrollable diff list; impact summary; Discard and Publish/Save actions.                                                           | Schedule draft mode      |
| Gap suggestion action      | Requirement-row action that opens eligible candidates ranked by fairness, role recency and weekend workload; one click stages the selected person in the draft.                                    | Schedule target UX       |
| Lock marker                | Per-cell lock state that protects a manual assignment from auto-population; locked assignment IDs are passed to generation.                                                                        | Schedule target UX       |
| Alert/context panel        | Gaps, conflicts and pending comp-offs relevant to the current region/date context. Current UI places alerts in page cards; an older design places the same content in a sidebar.                   | Dashboard/Schedule       |
| Error boundary             | Page-level fallback that preserves global navigation, gives a retry action and prevents one failed view from blanking the entire application.                                                      | All pages, target UX     |

### 3.3 Widget implementation and composition

The UI is deliberately built from a small shared vocabulary rather than an unrelated component per page:

- the shared component library supplies the application `Header`, masthead navigation, buttons, segmented selection, tags, switches, dropdowns, inputs, search input and overlay/modal shell;
- AG Grid supplies the detailed schedule table, pinned columns/rows, custom cell renderers and full-width group rows;
- ordinary semantic HTML tables are used for People, Settings and the compact long-range grid where AG Grid behavior is unnecessary;
- timeline charts are custom React components rendered with CSS grid/flexbox and absolutely positioned blocks—there is no charting-library dependency;
- date controls and all date arithmetic are custom compositions over `date-fns`; timezone conversion is designed around `date-fns-tz` and IANA zone names;
- the assignment picker is rendered as a floating portal so it is not clipped by grid overflow;
- drag/drop packages are installed for the target move/swap/palette interactions, but the current detailed grid does not yet activate them;
- role colors come from configuration and are reused by cells, badges, timelines, distribution bars and settings previews.

The original source uses a private/shared design-system package and theme. Its organization-specific package name is intentionally omitted from this sanitized handoff. A rebuild may substitute an equivalent accessible component system while preserving the dimensions, hierarchy, states and interaction contracts specified here.

### 3.4 Interaction states

- **Hover:** clickable rows/cells gain pale-blue or pale-gray background; role badges may slightly scale and gain a shadow.
- **Focus:** keyboard focus must be visible with a blue outline/border, even where the current implementation suppresses native grid cell focus.
- **Selected:** People table row uses pale blue; active date range and zoom button use blue fill.
- **Disabled:** lower contrast and no click response; Save and Undo are disabled without changes.
- **Changed:** settings rows receive a changed-state highlight; draft cells should be distinguishable from published cells in the target UI.
- **Error/conflict:** red border or background plus textual explanation; color alone is insufficient.
- **Loading:** retain page structure with skeleton rows/spinner and disable destructive actions.
- **Empty:** explain why no data is visible and give the next valid action.

---

## 4. Page-by-page product specification

### 4.1 Dashboard — operational overview

**User question:** “Are we covered now and during the selected period, and where must I act?”

The page begins with `Dashboard` and today’s long-form date. Below it, a single summary card contains:

1. **On Shift** — total filled assignments for today across visible regions;
2. **Regions** — number of regions currently included;
3. **Gaps** — current unmet requirements, red when nonzero and green when zero;
4. **Handovers** — unique visible handover definitions;
5. **Gap Days (Week)** — number of days in the current Monday–Sunday week containing any gap;
6. **People** — included people under current region and Only Me filters.

When gaps or conflicts exist, an **Attention Required** card appears. Each gap line shows `GAP`, region, long role name, role code, required count, filled count and number of eligible suggestions. Conflicts use a separate `CONFLICT` badge and description. The card disappears when no attention items exist.

The **Coverage Timeline** card shows the active display time zone, the date-range widget and one collapsible card per visible region. Region headers show a 24-hour minibar: APAC blue, EMEA green, AMER red; a red now marker crosses the bar; a left red edge marks a region with a gap. Expanding a region shows multi-day shift timelines for the selected range. Dashboard rendering is limited to 14 days even if a larger zoom is chosen.

**Target navigation behavior:** selecting a gap opens Schedule with the same region/date and, where possible, highlights the missing role. Selecting a region timeline block opens its people/role details.

### 4.2 Schedule — main planning workspace

**User question:** “Who is assigned on each day, does the rota meet the rules, and what should I change?”

The page contains a title followed by one large white planning card.

#### Toolbar

The date-range widget occupies the top of the card. It provides backward, Today and forward controls; a human-readable date range; zoom choices; preset ranges; a day strip; and, for long ranges, a year minimap whose selected window can be moved.

Below it is a right-aligned action row:

- read mode: **Export** and **Edit**;
- draft mode: **Generate/Auto-populate**, **Undo**, **Cancel**, and **Save (N)** where N is the pending change count.

#### Standard planning grid

For day/week/two-week/month-style detail views, the first column is pinned and labeled **Team Member**. It is 185px wide and supports text filtering. Each person cell shows display name and muted initials; hover title contains location and shift.

Date columns are narrow (normally 62px). Headers show three-letter weekday and date number. Weekends are muted; today has pale-blue fill and red underline. Cells are horizontally scrollable while names remain pinned.

When one region is selected, people are grouped by **Support**, **Service Transition** and **Management**, each with an uppercase full-width header and person count. With `ALL`, the current grid uses one `All` group; the target global view should optionally group by region first to match the workbook and reduce ambiguity.

Each assignment is a full-cell role chip. Working roles use configured colors and white text. `Off`, `Comp-Off`, `PH`, `Leave`, `WFH-Off` and `0` are visually muted. An empty cell is blank; an ineligible weekend cell shows an em dash.

A pinned bottom **Coverage** row appears when exactly one region is selected. Each date shows `filled/required`. Green means all minimums are met; red means at least one role is below minimum. Hover title lists gaps such as `Lead: 0/1`. The ratio counts working people while the rule check remains role-specific.

#### Compact long-range view

Three- and six-month zooms use a read-only heatmap. Each person occupies one row; each day is a very small colored cell; week headers group days. Names remain sticky while both axes scroll. This view is for pattern recognition, leave blocks, role density and fairness—not detailed editing.

#### Editing a cell

In read mode, clicking a cell does not change data. After **Edit**, clicking opens a floating picker:

1. **Roles** section — only roles in that day’s configuration for which the person is eligible, plus default roles available to the region;
2. **Non-working** section — `Off`, `Comp-Off`, `PH`, `Leave`;
3. **Clear** — shown only when an assignment exists, styled as destructive.

Selecting an item immediately changes the visible cell and adds a draft change. Coverage recalculates immediately. The picker closes after selection or an outside click.

**Current limitation:** Save only accepts in-memory changes and exits draft mode. **Target:** Save opens review; Publish writes an atomic published revision. Drag/drop, multi-select, fill patterns and a right-click menu remain target interactions, not current behavior.

#### Target bulk, drag and suggestion interactions

- Right-click offers Assign, Clear, Set Off, Set Comp-Off and Add Note.
- Shift-click or drag-selection selects multiple cells; a bulk action applies one value to the selection.
- Fill Pattern repeats a selected role/status sequence across a date range.
- Dragging a populated cell to another date moves it; dragging between people swaps only when both resulting assignments are valid; dragging from a role palette creates an assignment.
- Valid drop zones highlight positively; invalid zones identify the eligibility, date or conflict rule that blocks the drop.
- A cell can be locked before Generate. Auto-populate receives the locked assignment IDs and cannot replace them.
- A red requirement cell exposes Suggest. The suggestion list is ordered by eligibility, availability, 90-day fairness, recency and personal weekend target. Choosing a candidate adds a draft change rather than publishing directly.
- Review Changes presents old and new values plus impact: gaps fixed, gaps created, conflicts and comp-offs generated or moved.

#### Multi-editor coordination

Only one open draft is allowed per editor, region and Monday week start. A second request by the same editor returns the existing session. Different planners may draft simultaneously. When another planner has an open session for the same region/week, show a blue informational banner rather than blocking entry. Publication always revalidates against the latest published state; a stale change receives a 409 conflict and opens the compare/refresh/reapply flow described in section 8. The current implementation does not yet provide server-backed collision discovery or live updates.

### 4.3 People — roster, fairness and comp-off view

**User question:** “Who is in the team, what can they do, how much have they worked, and what time off is owed?”

The title row contains `People` and a search field. The main area is a split layout: a scrollable table on the left and a details panel on the right when a person is selected.

The table columns are:

- Name and initials;
- Region;
- Location;
- Shift;
- working **Days (3mo)**;
- available **Comp-Off** balance;
- colored **Eligible Roles** badges;
- **Weekend** eligibility shown as check or dash.

Region and Only Me global filters apply. Search matches display name, location and eligible role code. The footer reports visible versus total included people.

Selecting a row opens the person panel:

1. header: person name, region tag, shift and close button;
2. period label: last three calendar months;
3. KPI strip: Working Days, Weekends, Comp-Off Due;
4. fairness banner: above, below or on target compared with regional team average, using a ±12% tolerance in the current UI;
5. Comp-Off Balance tiles: Earned, Taken, Pending, Expired;
6. Role Mix: one row per role with colored role badge, percentage bar, percentage and count;
7. expandable **Profile & Configuration**: location, organizational role, week pattern, default entry, weekend eligibility and eligible roles.

**Target admin behavior:** profile fields and eligibility become editable through an explicit edit state; normal selection remains read-only. Changes require Save/Cancel and should not alter an open draft invisibly.

### 4.4 Settings — scheduling model configuration

**User question:** “What rules drive the schedule and how should the product display it?”

Settings is a vertically scrolling sequence of cards.

**User Preferences card:** role selector (development only in current UI) and Home Region dropdown.

**Display Options card:** switches for Show Off/Leave days, Show weekends, Highlight coverage gaps and Highlight scheduling conflicts.

**Region Configuration:** one card each for APAC, EMEA and AMER. Each contains:

- editable region name;
- searchable IANA timezone dropdown;
- comma-separated location list;
- Shifts table: Name, Code, Timezone, Start, End, calculated Hours;
- one Roles table per configured day group: immutable code, editable name, minimum, optional maximum (`∞` when blank), color picker and remove action;
- inline **Add Role** form with code, name, minimum and color;
- Weekend Roles as tags with minimums, plus Saturday/Sunday timing summary;
- read-only Comp-Off Rules summary in the current UI.

As soon as configuration differs from the saved snapshot, `Unsaved changes` appears beside the page title and a sticky bottom action bar appears. Both provide Cancel and Save All. Changed shift/role rows are highlighted. Leaving the page with unsaved changes should trigger confirmation in the target UX.

**Target additions:** editable comp-off controls, holiday calendar, handover editor, authorization mappings and validation preventing duplicate role codes or invalid time ranges.

The complete administration design also includes:

- add, edit, deactivate and reactivate people without deleting assignment history;
- role-eligibility checkboxes, default shift, weekend eligibility, maximum weekends per quarter and blackout dates;
- reorderable day-group role requirements and atomic replacement of a region's complete day configuration;
- per-location/per-year holiday maintenance, CSV import and a preview of which people and coverage requirements are affected;
- editable handover time, overlap duration and DST adjustment;
- an authorization-mapping view for identity groups and temporary user grants/denies, with an effective-access explanation;
- role and shift validation before Save All; invalid configuration remains dirty and cannot be persisted.

### 4.5 Real-time timeline and day drill-down

The dashboard already embeds timeline components, but a standalone Timeline route and day drill-down are target pages.

The full timeline consists of:

- selected date and display-time-zone label;
- 0–24 hour axis or multi-day axis;
- one regional section with one track per role;
- horizontal shift blocks positioned by local-to-display-time conversion;
- role code and assigned count in each block;
- dashed gap blocks where a required role is unfilled;
- pale amber vertical handover bands and labels;
- vertical red **NOW** marker updated each minute;
- optional bottom headcount strip;
- click/hover details listing assigned synthetic/display people.

The day drill-down uses the same visual grammar but expands one day and shows each assigned person as a bar. It is entered from a date header or Dashboard alert and provides an Edit action for planners.

### 4.6 Reports and export targets

Beyond the current CSV export and People metrics, the documented complete product includes:

- a print/PDF-friendly full-month schedule;
- person statistics for hours, weekends, comp-off balance and role distribution;
- regional coverage percentage over time and gap frequency;
- a role-equity chart and rotation-fairness heatmap; and
- exports that respect the active region/date filters while clearly identifying the display timezone.

These are target capabilities. They must be based on published assignments unless the export is explicitly labeled as a draft preview.

---

## 5. User workflows

### 5.1 Viewer: check global coverage

1. Sign in and land on Dashboard.
2. Keep `ALL` selected to see global summary counts.
3. Review Attention Required; gaps identify region, role and shortage.
4. Expand each regional timeline to understand when coverage starts/ends and where handovers occur.
5. Change display time zone if coordinating from another location.
6. Open Schedule for detailed people-by-day assignments.
7. Turn on Only Me to isolate personal duties.

### 5.2 Planner: correct a gap

1. Select the planner’s region in the global header.
2. Open Schedule and navigate to the week containing the gap.
3. Inspect the Coverage row and role-specific tooltip.
4. Select **Edit**; the Draft tag appears globally.
5. Click an empty cell for an eligible, available person.
6. Select the missing role from the role picker.
7. Confirm that coverage changes from red to green and that no conflict appears.
8. Repeat as needed; Undo reverses the latest operation.
9. Select Cancel to reverse the complete current draft, or Save/Review to continue.
10. **Target:** review old/new values and impact, then Publish atomically. The published schedule becomes visible to viewers.

### 5.3 Planner: generate a rota

1. Select one region and the required date range, no longer than 92 days.
2. Enter Edit and select Generate/Auto-populate.
3. Existing locked assignments remain unchanged.
4. Defaults fill ordinary workdays; specialist and weekend roles use eligibility and fairness ordering; holidays are applied; comp-offs are suggested.
5. Generated results remain draft changes, never immediate published data.
6. Planner checks coverage, fairness, off-day placement and exceptions.
7. Planner manually adjusts cells, reviews changes and publishes.

### 5.4 Planner: manage weekend work and comp-off

1. Assign separate Saturday and Sunday roles; each date is an independent assignment.
2. For every qualifying weekend assignment, create a linked comp-off entitlement.
3. Offer the earliest free valid date inside the configured before/after window, excluding configured weekdays such as Monday and Friday.
4. If no valid date exists, show Pending Approval rather than silently dropping the entitlement.
5. In People, verify Earned, Taken, Pending, Expired and Due values.
6. Moving a comp-off retains its link and is validated against the allowed window.

### 5.5 Administrator: onboard or change a person

1. Open People and search for the person; create if absent.
2. Set location, region, shift, organizational role, default week and default entry.
3. Set role eligibility and weekend eligibility.
4. Optionally set blackout dates, preferred partners and maximum weekends per quarter.
5. Save changes; historical assignments remain attached to the stable person ID.
6. Deactivation sets the person inactive for future planning instead of deleting history.

### 5.6 Administrator: change a regional rule

1. Open Settings and locate the region card.
2. Edit shift time/timezone or the role minimum/maximum for the relevant day group.
3. Use color picker to keep the visual role language consistent.
4. Changed rows highlight; dirty bars appear.
5. Save All after validation or Cancel to restore the prior snapshot.
6. Coverage is recomputed from the effective date. **Target:** rule changes are versioned/effective-dated so historical coverage is not reinterpreted unexpectedly.

### 5.7 Spreadsheet migration workflow

1. Upload/select a recognized workbook and sheet.
2. Preview detected sheet type and date range.
3. Map source people to existing stable person IDs; do not import real identity values into demo data.
4. Normalize aliases such as `coff`, `C-Off`, `compff` to `Comp-Off`, while showing the original value.
5. Show warnings for unknown values, duplicate person/date cells and missing people.
6. Import valid rows into a draft preview.
7. Planner reviews schedule, coverage, holiday assignments and weekend links.
8. Publish through the same controlled workflow as manually entered changes.

---

## 6. Data and entity model in product language

### 6.1 Relationship overview

```text
Region
 ├─ contains Locations
 ├─ defines Shifts
 ├─ defines Day Configurations
 │    └─ each contains Role Requirements
 ├─ defines Weekend Configuration
 ├─ owns Comp-Off Rules
 └─ participates in Handovers

Person
 ├─ belongs to a Region, Location and default Shift
 ├─ has Eligible Roles and Preferences
 └─ receives Assignments

Assignment
 ├─ joins one Person + one Date + one Role/Status
 ├─ contributes to a computed Coverage Snapshot
 ├─ may earn or represent Comp-Off
 └─ has append-only History

Draft Session
 └─ contains ordered Draft Changes
        └─ create, update or delete Assignments on Publish

Holiday
 └─ affects Locations on a Date; working coverage remains an Assignment
```

### 6.2 Region

A Region is a scheduling rule boundary (`APAC`, `EMEA`, `AMER`), not merely a label. It owns the local conventions used to interpret a date: locations, primary timezone, shift definitions, day-of-week role requirements, weekend pattern and comp-off rules. A region can include several locations and shifts with different time zones.

### 6.3 Location and shift

A Location is an office/site used for holiday applicability and team grouping, such as Singapore, Pune, London, Zurich, Chicago or New York. A Shift defines code, long name, timezone, local start/end, break and total hours. Times are local wall-clock definitions; rendered UTC/display times vary with date and DST.

### 6.4 Day configuration and role requirement

A Day Configuration groups one or more weekdays and states what roles apply. Each Role Requirement has code, long name, minimum, optional maximum, default flag, color and optional timing override. Friday may have a different configuration from Monday–Thursday; weekends have another.

Requirements are configuration, while assignments are actual people. Coverage is the comparison between the two.

### 6.5 Person

A Person has a stable internal ID; display name and initials; location, region and default shift; organizational category; default weekly pattern and default role entry; active/include state; weekend eligibility; optional identity/email; eligible roles; and preferences. Eligibility means the person may perform a role; it does not mean they are scheduled for it.

Preferences include maximum weekend workload, preferred partners and blackout dates. They influence suggestions and rotation but do not replace explicit published assignments.

### 6.6 Assignment and status semantics

An Assignment connects one person to one date and one role/status. It also stores region, weekend flag, optional notes, creation/update identity and concurrency version.

The source workbooks mix working roles and statuses in the same visual cells. The product may retain a single `roleCode` for compatibility, but behavior must distinguish:

- working role: counts toward coverage and fairness;
- `Off`/`Leave`/sick: unavailable, does not count as coverage;
- `PH`: holiday non-working marker, location-sensitive;
- `Comp-Off`: linked compensatory absence;
- `0`: explicit non-working/default-weekend marker, not identical to blank;
- blank: no recorded decision/assignment;
- Training: unavailable or activity depending on configured policy;
- on-call: working duty with its own coverage semantics.

The current database assumes one assignment per person/date. If simultaneous ordinary and on-call duties must be supported, the rebuild must either make on-call a separate duty entity or relax that constraint with explicit conflict rules.

### 6.7 Weekend assignment and comp-off link

Weekend work is an ordinary dated assignment marked as weekend. A comp-off is another dated assignment for the same person. A link entity connects the earning weekend assignment to the compensating absence. One weekend date can support one or more linked comp-off records if rules permit, and Saturday/Sunday remain separate earning events.

### 6.8 Holiday

A Holiday defines date, name, affected locations and full-day flag. It does not itself say who works. A person may be marked `PH` while another person has an AMER/on-call role on that same holiday. Holiday configuration and holiday coverage assignments must therefore remain separate.

### 6.9 Draft session and draft change

A Draft Session belongs to one editor, region and Monday week start and has Open, Published or Discarded status. It contains timestamped changes. A change records create/update/delete, the affected assignment, previous value and desired new value. Undo removes/reverses a pending change. Publish applies the ordered set as one transaction and writes history.

### 6.10 Coverage snapshot

Coverage is computed, not maintained manually. For one region/date it contains filled count by role, gaps, conflicts, headcount, total required and total filled. It is recalculated after every draft change and authoritatively rechecked during publication.

### 6.11 Handover

A Handover joins a source region and destination region with a configured time and overlap duration. DST adjustments affect displayed UTC position but not local shift definitions. It appears as a labeled band on timelines.

### 6.12 Authorization mapping

A Role Mapping connects an identity-provider group to Viewer, Planner or Admin and may scope Planner to one region. A User Override grants or denies an app role temporarily or permanently. Deny takes precedence. This access model is separate from a person’s scheduling-role eligibility.

---

## 7. Product rules and UX validation

1. A person cannot be assigned to a role for which they are ineligible unless an explicit authorized override exists.
2. A person/date cannot contain conflicting duties.
3. A required role below minimum is a gap; above maximum is a warning/conflict according to configuration.
4. Non-working states never satisfy working-role requirements.
5. Weekend-only roles appear only on configured weekend dates.
6. Friday uses Friday requirements, not Monday–Thursday requirements.
7. Holiday location controls who receives holiday treatment.
8. Draft edits never become visible as published data before publication.
9. Publication with unresolved conflicts is blocked; an Admin force action must be explicit and audited.
10. A stale assignment version produces a refresh/compare message rather than overwriting another planner silently.
11. Every weekend-generated comp-off preserves its source link.
12. Unknown imported codes are warnings requiring mapping, not silently accepted role codes.
13. Dates are shown with weekday and date; times always display a timezone.
14. Green/amber/red states always have text or icons so meaning does not depend only on color.

---

## 8. Empty, loading, error and confirmation behavior

| Situation                  | Required UX                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No assignments in range    | Keep people/date structure visible, show empty cells and red coverage requirements; explain “No assignments scheduled” and offer Edit to planners. |
| No people under filters    | Show “No people match this region/filter” with Clear filters action.                                                                               |
| No gaps                    | Hide Attention Required or show concise success state; never leave an empty alert box.                                                             |
| Loading schedule           | Preserve card dimensions, show skeleton/spinner, disable editing and publishing.                                                                   |
| Failed load                | Inline error with Retry; identify whether cached data is being shown.                                                                              |
| Failed publish             | Keep the draft and all changes; show actionable error and retry. Never clear the draft.                                                            |
| Ineligible assignment      | Red cell treatment and explanation naming the role and missing eligibility.                                                                        |
| Concurrent change          | Show published value versus draft value and offer Refresh/Reapply, not silent overwrite.                                                           |
| Cancel draft               | Confirmation states number of changes that will be reversed.                                                                                       |
| Leave Settings dirty       | Confirm Save, Discard or Stay.                                                                                                                     |
| Auto-populate no candidate | Keep a visible gap with reason such as no eligible/available person.                                                                               |
| Comp-off no valid date     | Create/show Pending Approval and link it to the earning duty.                                                                                      |

---

## 9. Accessibility and responsive behavior

- Primary editing target is desktop at 1280px and above; 1024px remains usable through horizontal scrolling.
- Below 1024px, prioritize read-only Dashboard, Only Me and personal schedule; dense schedule editing may be disabled rather than made unsafe.
- The planning grid supports keyboard movement, Enter to open a picker, Escape to close, and Ctrl/Cmd+Z to undo in target behavior.
- Date headers and person names are semantic headers; role cells have labels including person, date, role and status.
- Dynamic coverage changes are announced through a polite live region.
- Popovers trap/follow focus appropriately and close with Escape.
- Role-chip text contrast must be checked for administrator-selected colors; automatically use dark or light text.
- Status is represented by text plus color.
- Motion is subtle and respects reduced-motion preference.

---

## 10. Current product versus intended complete product

| Area                  | Current behavior                                                                                            | Required complete behavior                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Shell/navigation      | Header, filters, user popover and four masthead pages work.                                                 | Secure role display; preserve filter/deep-link context.                                                   |
| Dashboard             | Summary, attention list and collapsible multi-day region timelines work on fixture/store data.              | Alert-to-schedule navigation and authoritative live data.                                                 |
| Schedule              | Standard AG Grid, compact heatmap, role picker, local draft tracking, undo/cancel/save and CSV export work. | Server draft sessions, review modal, atomic publish, conflict reconciliation, drag/bulk/fill if retained. |
| People                | Search, table, three-month KPIs, fairness, comp-off stats, role mix and profile accordion work.             | Admin editing, history and backend data source throughout.                                                |
| Settings              | Preferences, display switches, region/shift/role editing, colors and dirty Save/Cancel work locally.        | Holidays, handovers, editable comp-off rules, authorization and persisted validation.                     |
| Timeline              | Embedded components exist on Dashboard.                                                                     | Standalone Timeline and day drill-down routes.                                                            |
| Spreadsheet scenarios | Fixtures and workbook source exist.                                                                         | Reviewed import workflow and anonymized fixture set.                                                      |

The rest of this document retains architecture, API, persistence and deployment material as a supporting implementation reference.

---

## 11. Technical architecture reference

```
shift-o-mator/
├── frontend/                     React/Vite SPA
├── backend/
│   ├── src/ShiftOMator.Api/      ASP.NET Core HTTP layer
│   └── src/ShiftOMator.Core/     Domain, application and infrastructure folders
├── charts/shift-o-mator/         Helm chart
├── docs/                         Design, API, database, plan and DevOps docs
├── scripts/deploy-local-to-aks.sh
├── compose.yaml
├── .gitlab-ci.yml
└── .env.example
```

### Runtime components

1. **Browser:** React 19, TypeScript strict mode, Vite, Zustand, a reusable component library and AG Grid-related dependencies.
2. **API:** ASP.NET Core controllers. Current projects target .NET 10; design documents originally target .NET 8 LTS.
3. **Database:** SQL Server through EF Core code-first, with the EF major aligned to the chosen runtime.
4. **Identity:** Microsoft Entra ID JWT bearer authentication through Microsoft.Identity.Web and MSAL in the SPA.
5. **Local containers:** Podman/Docker-compatible frontend and backend images; SQL Server is defined but currently commented out in `compose.yaml`.
6. **Cluster:** AKS/Kubernetes using Helm 3, nginx ingress and externally created Kubernetes secrets.
7. **CI/CD:** GitLab CI with lint, test, build, image publish and UAT/production deployment stages.

The backend has only two projects. Application, Domain and Infrastructure are folders/namespaces inside `ShiftOMator.Core`; they are not separate projects despite some documentation and the Dockerfile referring to a separate Infrastructure project.

### Backend layering

```
Controllers / HTTP
        ↓
Application services and pure engines
        ↓
Domain entities
        ↓
Infrastructure: EF Core DbContext, persistence, claims transformation
```

Controllers return DTOs. Services orchestrate persistence and transactions. Engines are intended to be deterministic and I/O-free.

---

## 12. Frontend implementation reference

### Stack and dependencies

- React 19 and React DOM 19: component rendering and composition.
- TypeScript 6 in strict mode and Vite 8: type checking, development server and production bundling.
- Zustand 5: small domain-focused stores without a single monolithic application store.
- React Router DOM 7: browser history, nested application layout, active navigation and target deep links.
- Axios 1.18: live API transport and bearer-token request interception.
- Microsoft Authentication Library: `@azure/msal-browser` and `@azure/msal-react` for sign-in, account state and silent API-token acquisition.
- A private/shared widget and icon system plus matching AG Grid theme; exact organization-specific package names are omitted from this sanitized specification.
- AG Grid Community/React 35: the detailed people-by-date schedule, pinned Team Member/Coverage rows, custom assignment cells and full-width group headers.
- `date-fns` 4 and `date-fns-tz` 3: ISO-date navigation, ranges, week/month/quarter boundaries and target IANA-zone conversion.
- `@dnd-kit/core`, sortable and utilities: installed for target cell move/swap, role-palette and bulk interactions; not wired into the current grid.
- CSS variables and design tokens in frontend public assets; custom CSS grid/flexbox for timelines and no chart-library dependency.

The `@` TypeScript alias points to `frontend/src`.

### Entry point and routes

`main.tsx` loads shared component CSS and application CSS, creates a `BrowserRouter`, wraps the application in `MsalProvider`, and renders `App`.

Current routes in `App.tsx`:

| Route        | Current component          |
| ------------ | -------------------------- |
| `/`          | Redirects to `/dashboard`. |
| `/dashboard` | `Dashboard`.               |
| `/schedule`  | `Schedule`.                |
| `/people`    | `People`.                  |
| `/settings`  | `Settings`.                |

The design documents additionally specify `/timeline`, `/schedule/day/:date`, `/settings/regions`, `/settings/roles`, and `/settings/holidays`; these routes/components are planned or incomplete in the current route table.

All current routes are children of `AppLayout` and are wrapped by `AuthGuard`.

### Legacy design layout reference

- Header: product identity, region selector, draft status, user menu and notifications.
- Sidebar: navigation, filters and alerts.
- Main area: dashboard, planning grid, people, settings or timeline.
- Lower/side coverage area: requirements and coverage status.

The running UI uses the two-level header and page cards described in section 2 and has no permanent sidebar. The sidebar/coverage-panel sketch above is obsolete and is not a rebuild requirement. Its useful concepts—navigation, filters, alerts and requirement status—are implemented through the masthead, global controls and page cards. Do not add a sidebar unless the product is deliberately redesigned.

### Planning grid UX

The primary planning surface is a people-by-date grid:

- rows are people grouped by region and shift;
- columns are dates;
- cells show color-coded role badges;
- region groups collapse and show headcount/gap summaries;
- footer cells show coverage status: green met, amber thin, red gap;
- week view shows 7 columns and full codes;
- two-week view shows 14 compact columns;
- month view shows 28–31 heatmap-like columns;
- quarter view shows 13 weeks/density strips;
- eligible-role dropdown is available on cell edit;
- context menu actions are Assign, Clear, Off, Comp-Off and Note;
- multi-select supports bulk changes;
- fill-pattern repeats a role pattern over a range;
- drag-and-drop moves assignments, swaps between people, or assigns from a role palette;
- drop validation checks eligibility.

Draft-mode UX: amber draft banner with region/week, unsaved browser-tab indicator, inline gap/conflict feedback, review-changes modal, publish action, and undo/redo. An informational blue banner is intended when another editor has an open session for the same region/week.

### Other designed views

**Dashboard:** region-by-day coverage heatmap, open gaps, upcoming handovers, active draft information, and current headcount by region.

**Day drill-down:** hourly timeline, assignments as bars, role annotations, inline gaps/conflicts, and edit entry point.

**Timeline:** horizontal 24-hour axis, one swim lane per region, shift blocks, animated NOW marker, handover overlap zones, hourly headcount strip, assignment detail popover, and persistent “who is on now?” summary.

Timeline and day drill-down do not require dedicated backend endpoints. They compose published assignment ranges, region/shift/handover configuration and coverage snapshots in the client. `/coverage/now` supplies the live summary and next handover. Add a specialized aggregation endpoint only if measured performance demonstrates that client composition is insufficient.

**People:** team list and administration of person attributes and role eligibility.

**Settings:** region and shift definitions, day requirements, role definitions, holidays, handovers, and authorization mappings.

### State and services

Planned/current Zustand responsibilities:

| Store           | Responsibility                                          |
| --------------- | ------------------------------------------------------- |
| `authStore`     | Current identity, display name, email, role and region. |
| `peopleStore`   | People, eligibility and filters.                        |
| `regionStore`   | Regions, shifts and day configurations.                 |
| `scheduleStore` | Published assignments and load/CRUD state.              |
| `draftStore`    | Draft ID, changes, undo state and publish state.        |
| `coverageStore` | Coverage snapshots recomputed after assignment changes. |
| `uiStore`       | Zoom, selected region/date range and filters.           |
| `configStore`   | Holidays and handovers.                                 |

Business-logic services are intended to be pure functions: coverage engine, auto-populate, rotation, comp-off, timezone utilities and export service. The frontend coverage engine must produce the same result as the backend engine for shared fixtures.

### Frontend data source switch

`VITE_USE_BACKEND=false` selects local fixtures under `frontend/src/data`. `true` selects API loading through Axios. `VITE_API_BASE_URL` is the Axios base URL. `useBootstrap` hydrates stores after authentication when live mode is enabled.

Fixtures include people, regions, sample schedules, holidays, weekend rotations and timezone data. Current known inconsistency: some pages/services directly import fixture data instead of reading stores, especially Dashboard, People and engine-related code; schedule loading is the most complete toggle-aware path.

### API client and store integration

The migration from fixtures to live data is incremental, not a big-bang replacement:

1. `MsalProvider` initializes and `AuthGuard` resolves the current account.
2. The API client acquires a token silently and adds `Authorization: Bearer …` to live requests.
3. `useBootstrap()` hydrates stores after authentication.
4. Each store's `init()` chooses fixtures or its domain API module according to `VITE_USE_BACKEND`; stores are migrated one at a time, beginning with read-only People/Regions/Schedule.
5. Domain modules cover people, regions/configuration, schedule, drafts, coverage, holidays and auto-populate.
6. API failures are parsed as RFC 7807 `ProblemDetails`; validation errors expose the field-to-message array. A 401 returns to authentication, 404 becomes a not-found state, and 409 enters concurrency reconciliation.
7. `coverageStore` remains hybrid: the client engine gives immediate draft feedback and the server result is authoritative on publish.
8. After successful publication, clear draft state and reload affected published assignments and coverage. On failure, preserve every pending change.
9. Once all stores and end-to-end tests use live endpoints, remove runtime fixture dependencies but retain sanitized fixtures for tests.

Generate TypeScript API types from the backend OpenAPI document during CI and fail contract checks when generated types drift. Keep generated transport types separate from UI/domain view models where transformation is needed.

### Authentication flow in the SPA

- `MsalProvider` wraps the app.
- `AuthGuard` waits for MSAL initialization.
- If no account exists, it calls `loginRedirect(loginRequest)`.
- It calls the configured auth endpoint and stores the returned identity; on failure it falls back to account claims and viewer-like defaults.
- Axios request interceptor calls `acquireTokenSilent` and adds a Bearer token.
- MSAL uses configured client ID, tenant ID, redirect URI and callback path.
- Current `loginRequest.scopes` contains only `openid`, `profile`, and `email`; it does not request the designed `ShiftOMator.Access` API scope.

---

## 13. Detailed scheduling rules

### Regions and working windows

| Region/area | Locations or shift context  | Typical local window                 |
| ----------- | --------------------------- | ------------------------------------ |
| APAC        | Singapore                   | 07:00–15:30, UTC+8                   |
| APAC        | Pune APAC shift             | 06:30–15:00, UTC+5:30                |
| APAC mid    | Singapore/Pune general/SRE  | Configured per shift                 |
| EMEA        | London/Stevenage            | 08:30–16:30, UTC+0/+1                |
| EMEA        | Zurich                      | 08:00–18:00, UTC+1/+2; role-specific |
| EMEA        | Pune EMEA shift             | 13:00–21:30, UTC+5:30                |
| AMER        | Chicago                     | 09:00–17:30 CT                       |
| AMER        | New York                    | 11:00–19:30 ET                       |
| AMER early  | Hartford/service transition | Early service-transition pattern     |
| AMER        | Pune AMER/batch             | Batch-late timing                    |

Configured regions are `AMER`, `EMEA` and `APAC`. Handover zones are APAC→EMEA around 08:00–09:00 UTC, EMEA→AMER around 14:30–16:00 UTC, and AMER→APAC around 22:00–00:00 UTC; exact values are configuration, not constants.

### Role codes

- APAC: `M`, `G`, `MC`.
- EMEA: `E`, `BM`, `BM-Lead`, `Shift-Lead`, `CH-Early`, `CH-SL`, `CH-OC`, `CH-OC-Mo`, `CH-OC-Ev`, `MOD`.
- AMER Mon–Thu: `Lead`, `Crew`, `Crew-BC`, `Batch-E`, `Batch-L`, `Batch-U`, `Cover`, `ST Amer`.
- AMER Friday: `Lead-E`, `Crew-E`, `Crew-L`, `Batch-E`, `Batch-L`.
- AMER weekend: `Primary`, `Secondary`, `ST`, `Shadow`.
- Cross-region/status codes: `Off`, `Comp-Off`, `PH`, `0`, `OnCall S2/S3`.

### Coverage requirements

Requirements are stored per region and day-of-week in `DayConfigs`.

- AMER Mon–Thu: Lead 1/1; Crew 1/unbounded; Batch-E 1/1; Batch-L 1/1; Cover 0/3; Crew-BC 0/1; Batch-U 0/1.
- AMER Friday: Lead-E 1/1; Crew-E 1/3; Crew-L 1/1; Batch-E 1/1; Batch-L 1/1.
- AMER weekend: Primary 1/1; Secondary 0/1; ST 0/1.
- EMEA weekday: Shift-Lead or BM-Lead 1/2; BM 1/unbounded; E 1/unbounded.
- APAC weekday: M 1/unbounded.

A coverage snapshot reports filled role counts, headcount, total required, total filled, gaps and conflicts. A gap exists when filled count is below minimum. Conflicts include double assignment, ineligible assignment and invalid/expired comp-off.

### Rotation

Rotation candidates are ordered by:

1. role eligibility;
2. availability (not Off, PH or PTO);
3. fewest assignments for that role in the previous 90 days;
4. recency, with the most recent worker deprioritized; and
5. personal targets such as `MaxWeekendsPerQuarter`.

Rotating roles include AMER Lead, Batch-E, Batch-L and weekend Primary/Secondary/ST patterns.

### Comp-off

- Weekend work normally earns one comp-off day.
- The region’s `CompOffRules` supplies `windowBefore`, `windowAfter`, excluded day numbers and approval behavior.
- Default excluded weekdays are Monday (1) and Friday (5).
- The engine chooses the earliest unscheduled eligible date in the window.
- If none exists, it returns `requiresApproval=true` for planner handling.
- Weekend and comp-off assignments are linked in `AssignmentCompOffLinks`; the comp-off may also point back through `LinkedWeekendAssignmentId`.
- Dates are stored without time; timezone/DST conversion is display-only.

### Holidays and DST

Holidays have a date, name, affected locations and full-day flag. Holiday coverage follows regional/weekend-style rules and holiday work may earn comp-off. Shift start/end values are local times and remain unchanged across DST; UTC handover overlap changes and is configurable/annotated.

Timezone processing uses IANA zones and the assignment date. A shift stores local wall-clock start/end, so its rendered UTC position changes when the location enters or leaves DST. Handover configuration stores a normal UTC time plus optional period-specific adjusted UTC time and overlap duration. The timeline resolves the applicable adjustment for the selected date, annotates the active offset/DST state and repositions both the handover band and connected shift blocks. Planners may update configured handover adjustments during seasonal transitions; historical dates must continue to render with the rule that applied to that date.

---

## 14. Backend implementation reference

### Projects

- `ShiftOMator.Api`: controllers, middleware and startup.
- `ShiftOMator.Core`: entities, DTOs/interfaces, engines, services, EF context/configurations and claims transformation.
- Tests: xUnit project skeletons for unit and integration tests.

### Backend libraries and responsibilities

- **Current source:** the project files target .NET 10 and reference ASP.NET Core controllers/OpenAPI, EF Core SQL Server 10, Microsoft.Identity.Web 4, FluentValidation ASP.NET Core 11, Mapster 10, Serilog ASP.NET Core 10 and Swashbuckle 10.
- **Documented original target:** .NET 8 LTS, ASP.NET Core 8 and EF Core 8. A rebuild must choose one supported runtime baseline and align project targets, package majors, container images and documentation; do not mix .NET 8 container stages with .NET 10 binaries.
- ASP.NET Core provides HTTP routing, authorization policies, health endpoints, CORS and rate limiting.
- EF Core is the SQL Server ORM and migration source; controllers must never return tracked EF entities.
- Microsoft.Identity.Web validates bearer tokens; claims transformation resolves application roles and region scope.
- FluentValidation is the documented target for request validation, but global validator registration is not visible in current startup and must be completed or replaced consistently.
- Mapster is referenced for entity/DTO mapping; manual mapping is acceptable where explicit and tested. AutoMapper is not part of the design.
- Serilog provides bootstrap and request logging. JSON/rolling-file/monitoring sinks and correlation enrichment are target additions beyond the current console-focused setup.
- Swashbuckle and built-in OpenAPI expose API documentation; production exposure must be disabled.
- Polly is reserved for future external HTTP resilience, such as graph membership lookup; no retry policy is required for ordinary in-process/database calls.

### Startup behavior currently in code

`Program.cs` registers controllers, OpenAPI, Microsoft.Identity.Web authentication, `RoleClaimsTransformation`, authorization policies, SQL Server `ShiftDbContext`, health checks, CORS, fixed-window rate limits, engines as singletons and application services as scoped dependencies. Exception middleware and Serilog request logging are enabled.

Current policies:

- default: authenticated user;
- `ViewerPlus`: authenticated user;
- `PlannerPlus`: `Planner` or `Admin` role;
- `AdminOnly`: `Admin` role.

Current health endpoints:

- `GET /health`: anonymous liveness endpoint returning 200.
- `GET /health/ready`: anonymous registered health checks; currently no EF database check is registered, so it does not yet prove database reachability.

OpenAPI is mapped outside Production, Swagger middleware/UI is always added in current code.

### Controllers currently present

| Base route                                                 | Implemented operations                                              | Access                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                                                | `GET /me`                                                           | Auth controller exists; identity response is defined by API contract.                                                        |
| `/api/people`                                              | GET list, GET by ID, POST, PUT, PUT eligibility, DELETE/deactivate  | Reads ViewerPlus; writes AdminOnly.                                                                                          |
| `/api/regions`                                             | GET list, GET by ID, GET handovers                                  | ViewerPlus. Design also specifies shift/day-config/metadata admin operations, but current controller does not expose them.   |
| `/api/schedule`                                            | GET range, GET assignment, GET assignment history                   | ViewerPlus; history PlannerPlus.                                                                                             |
| `/api/drafts`                                              | POST/open, GET by ID, GET mine, add/remove change, publish, discard | PlannerPlus; publish and changes are rate-limited as configured. Admin-only force is enforced in controller.                 |
| `/api/coverage`                                            | GET snapshot, GET range, GET gaps                                   | ViewerPlus.                                                                                                                  |
| `/api/auto-populate`                                       | POST                                                                | PlannerPlus; limited to a maximum 92-day span and rate-limited.                                                              |
| `/api/holidays`                                            | GET list, POST, PUT and DELETE                                      | Reads ViewerPlus; writes AdminOnly. Current GET filters by from/to/location rather than the contract's required year filter. |
| `/api/admin/role-mappings` and `/api/admin/role-overrides` | Designed in API contract                                            | Controller file exists in the repository; verify/complete operations during rebuild.                                         |

All authenticated API endpoints use `/api` as the base path and should return RFC 7807 `ProblemDetails`; exact validation/error behavior must be preserved from `docs/api-contracts.md`.

The complete documented contract additionally requires:

- region metadata update, shift update, complete day-config replacement and handover update operations;
- holiday list filtered by year/location plus create, update and delete;
- `GET /coverage/now` for active assignments and next handover;
- `GET /coverage/{date}/suggest?region=&roleCode=` returning ranked candidates for gap resolution;
- role-mapping CRUD, user-override list/create/delete and effective-access explanation;
- `POST /drafts` returning the existing open draft with 200 or a newly created draft with 201;
- adding a draft change returning the created change and updated gap information;
- publish returning created, updated, deleted, generated-comp-off and remaining-gap counts;
- discard retaining the session for audit instead of deleting it; and
- health liveness always returning 200, while readiness returns 200 only when the database is reachable and otherwise 503.

Comp-off rules are part of the Region payload and are read/updated through the region operations; there is no separate comp-off-rules endpoint. Handover writes include name, source/destination regions, normal UTC time, overlap duration and an optional adjustment object such as `{ period, adjustedTimeUtc }`. Admin role mappings support list/create/update/delete; user overrides support list/create/delete plus effective-access resolution.

### API contracts

Implement the request/response shapes in `docs/api-contracts.md`. Key shapes:

- Person response: ID, display name, initials, location, region, shift, role, default entry/week, weekend eligibility, include flag, optional generic employee ID and eligible roles.
- Assignment response: GUID, person fields, date, role code, region, weekend flag, comp-off link, notes and audit timestamps.
- Draft session: GUID, editor identity ID, region, Monday week start, status, timestamps and ordered changes.
- Draft change: optional assignment ID, `create`/`update`/`delete`, old/new JSON values and timestamp.
- Coverage snapshot: date, region, counts, requirements-derived gaps and conflicts.
- Publish result: created, updated, deleted, generated comp-offs and remaining gaps.

Contract-level behavior:

- `GET /people` accepts optional region and include filters; person deletion is a soft deactivation.
- `GET /schedule` requires region/from/to and is read-only; every published mutation goes through a draft.
- `GET /coverage`, range and gaps endpoints accept ISO dates and return role counts, gaps, conflicts, headcount and required/filled totals.
- Auto-populate accepts region, from, to and locked assignment IDs; ranges over 92 days are rejected.
- Region-scoped planner operations require a matching region claim or Admin access.
- Validation failures return 400 with `errors: { field: string[] }`; missing resources return 404; stale writes or blocked publication return 409; unexpected failures return sanitized 500 responses with a correlation ID.
- Assignment row versions must be represented in write/review contracts so optimistic concurrency can be enforced, even where the older example DTO omitted the field.

Writes to published assignments must not be exposed as direct schedule CRUD; they go through draft changes and publish.

### Pure engines

Expected backend engine interfaces:

- `CoverageEngine`: assignments + region config + holidays → snapshot.
- `RotationEngine`: date + role + people + assignments + preferences → ordered candidates.
- `CompOffEngine`: weekend assignment + rules + existing assignments → date/approval result.
- `AutoPopulateEngine`: region/date range/locked IDs → draft changes.

Auto-populate sequence: load day config; assign default entries to included people; rotate special roles; rotate weekends; generate comp-offs; mark holidays; return changes. Date range maximum is 92 days.

### Draft publishing transaction

1. Begin SQL transaction.
2. Apply draft changes in timestamp order.
3. Insert/update/delete published assignments.
4. Generate and link comp-offs for new/updated weekend work.
5. Append assignment history.
6. Mark draft `Published`.
7. Commit atomically.

Draft statuses are `Open`, `Published`, `Discarded`. The intended uniqueness rule is one open session per editor, region and Monday week start; the wider design also informs planners if another editor is active for the same region/week.

### Claims transformation

`RoleClaimsTransformation` is intended to:

1. read the subject/object identity and `groups` from the JWT;
2. match enabled group IDs to `RoleMappings`;
3. add non-expired per-user grants;
4. apply denies with precedence;
5. add role and optional region-scope claims; and
6. cache the result for the request.

For tenants with more than 200 groups, Entra may send `hasgroups` rather than the group list; Microsoft Graph enumeration is not implemented and is required for full production behavior.

Role results are cached only for the current request. Group mappings handle normal membership, temporary per-user grants respect expiry, and explicit denies override every grant. A custom authorization handler must compare the requested route/query region with the planner's scope. If group overage is supported, enumerate membership through the identity provider's graph API using least privilege and bounded caching; do not trust an absent `groups` claim as meaning no membership.

### Validation, errors and observability

The documented target uses declarative validators for these rules:

- opening a draft requires a known region and a Monday week start;
- draft changes require valid assignment fields, an existing person, role eligibility and a date inside the session week;
- publication requires an open caller-owned session and no unresolved conflict unless an Admin explicitly forces it;
- included people require display name, region and at least one eligible role;
- holidays require a valid date and one or more locations; and
- auto-populate requires a known region, appropriate regional access and a range no longer than 92 days.

Exception middleware maps validation/not-found/conflict exceptions to 400/404/409 and all other failures to 500. Non-development responses never expose stack traces, SQL details or column names. Every request receives or generates a correlation ID and structured request logs include method, path, status, duration and generic user identifier. Target monitoring metrics include open-draft count, publish duration and coverage-query duration. Swagger/OpenAPI is available only in non-production development/test environments with bearer-token support and generated XML comments.

### Performance and concurrency targets

- Composite-index assignments by date and region.
- A 13-week coverage query with a representative 500-assignment data set targets under 200 ms p95; the broader performance smoke target is under 250 ms p95 for coverage and schedule endpoints.
- Cache `/coverage/now` output for no more than 30 seconds.
- Rate-limit auto-populate to 5 requests per minute per user and publish to 10 requests per minute per user.
- Publish revalidates against current state and uses one serializable transaction.
- EF `rowversion` failures become 409 responses; the client never silently overwrites.

---

## 15. Database implementation model

The intended database is MSSQL with EF Core code-first and default schema `shift`. **Current `ShiftDbContext` sets the default schema to `shiftomator`, so the rebuild must choose one schema and align all documentation, migrations and queries.** Current EF configuration also points migrations to assembly `ShiftOMator.Infrastructure`, a project that does not exist.

### Tables

1. **People:** stable string ID, display identity, location, region, shift, organizational role, default entry/week, weekend eligibility, include flag, optional generic employee ID/email and timestamps.
2. **PersonEligibleRoles:** composite person/role-code key.
3. **PersonPreferences:** one-to-one person record; max weekend target, preferred-partner JSON and blackout-date JSON.
4. **Regions:** region ID/name, primary IANA timezone, locations JSON and serialized comp-off rules.
5. **ShiftDefinitions:** region shift code/name, IANA timezone, local start/end, break minutes and total hours.
6. **DayConfigs:** region, CSV day numbers and serialized role requirements JSON. A requirement contains role code/name, minimum, maximum, default flag and optional timing override.
7. **Holidays:** date, name, locations JSON and full-day flag.
8. **Handovers:** from/to regions, UTC time, overlap duration and optional DST adjustment JSON.
9. **Assignments:** GUID, person, date, role, region, weekend flag, comp-off linkage, notes, audit fields and rowversion. Intended unique constraint: one assignment per person/date.
10. **AssignmentCompOffLinks:** composite weekend-assignment/comp-off-assignment link.
11. **AssignmentHistory:** append-only assignment/action/snapshot/actor/timestamp audit rows.
12. **DraftSessions:** editor, region, Monday week start, status and activity timestamps.
13. **DraftChanges:** session, optional assignment, change type, previous/new serialized values and timestamp.
14. **RoleMappings:** Entra group ID/name, app role, optional region scope, enabled flag and timestamps; unique group/role/scope.
15. **UserRoleOverrides:** user ID/app role/region/mode key, reason, creator, timestamps and optional expiry; deny overrides win.

Relationships: people have eligible roles, preferences and assignments; regions have shifts and day configs; assignments have history and comp-off links; drafts have changes; role mappings and overrides are consumed by claims transformation.

Use `DateOnly`/SQL `date` for schedule dates, `DateTime` for audit timestamps, JSON serialized in `nvarchar(max)`, and `rowversion` for assignment concurrency. Generate an initial migration and seed at least three regions, default shifts/day configs and the documented holiday set before using live deployment.

---

## 16. Configuration and local execution

### Frontend variables

- `VITE_API_BASE_URL`: API base, normally ending in `/api`.
- `VITE_USE_BACKEND`: literal `true` enables live API; otherwise fixtures.
- `VITE_CLIENT_ID`: Entra application client ID.
- `VITE_TENANT_ID`: Entra tenant ID.
- `VITE_REDIRECT_URI`: registered MSAL redirect URI.
- `VITE_CALLBACK_PATH`: callback path skipped by guard initialization.
- `VITE_AUTH_URL`: identity endpoint, default `/auth/me`.

Vite values are build-time values in container deployments.

### Backend variables/configuration

- `ConnectionStrings__ShiftDb`.
- `AzureAd__TenantId`.
- `AzureAd__ClientId`.
- `AzureAd__Instance` should be `https://login.microsoftonline.com/`.
- `AzureAd__Audience` should identify the API app registration.
- `Authorization__RequiredScope` should be `ShiftOMator.Access`.
- `Authorization__GroupClaimType` should identify `groups`.
- `AllowedOrigins`.
- `ASPNETCORE_ENVIRONMENT` and `ASPNETCORE_URLS`.

Development settings use placeholders for identity configuration, localhost origins and the local SQL connection; no real credentials or environment identifiers belong in this document or source control.

### Commands

Frontend:

- from root: `npm run dev`, `npm run build:frontend`, `npm run typecheck:frontend`;
- from `frontend`: `npm run dev`, `npm run build`, `npm run typecheck`.

Backend:

- `cd backend && dotnet restore`;
- `dotnet run --project src/ShiftOMator.Api`;
- use User Secrets for connection string and Entra settings;
- generate/apply EF migration only after resolving project/schema configuration.

Full stack intended command: `podman compose -f compose.yaml up --build`, but the current compose file has frontend and MSSQL services commented out, so it currently defines only a backend service whose dependencies refer to the disabled MSSQL service. Enable/fix those services before treating compose as functional.

---

## 17. Containers and deployment

### Frontend image

Multi-stage build: `node:22-alpine` runs `npm ci` and Vite build; `nginx:1.27-alpine` serves the result on port 8080. `nginx.conf` must provide SPA fallback, `/nginx-health`, one-year caching for `/assets/*`, and no-cache behavior for `index.html`.

### Backend image

Intended multi-stage build: matching .NET SDK publish, EF migration bundle creation, then the corresponding ASP.NET runtime. The original Docker design uses .NET 8 while current project files target .NET 10; align them before building. Runtime should use non-root `appuser`, port 5000, `/health` liveness and `/health/ready` readiness. Current migration stage references nonexistent `src/ShiftOMator.Infrastructure`; correct it to the project containing the EF context/migrations.

The migration stage generates an executable `efbundle`, copies it into the runtime image and marks it executable. The application container does not apply schema changes on ordinary startup. A one-shot Kubernetes Job invokes the bundle with the database connection supplied from a secret before new backend pods roll out.

### Helm

Chart: `charts/shift-o-mator`. Base values use two frontend/backend replicas, frontend port 8080, backend port 5000, nginx ingress, configurable registry/tag, resource limits, probes and optional migration hook. Non-production examples must use a reserved placeholder host such as `shift-o-mator.uat.example.invalid`; real internal or production hosts must not appear in this specification.

The chart contains chart metadata, base values, non-production/production override files, shared template helpers, separate frontend/backend Deployments and Services, ingress, and an optional migration Job. Environment overrides set image tag, replica counts, resource values and placeholder ingress host; CI supplies the immutable commit image tag. The migration Job is a `pre-install,pre-upgrade` hook and is disabled by default until the database and valid bundle exist.

Kubernetes secret `shift-secrets` is created out-of-band in each namespace. It supplies database connection string and Entra tenant/client values. Image pull secrets are optional when AKS is attached to ACR. The migration Job is disabled by default and should run as a pre-install/pre-upgrade hook only after the database exists and the migration bundle is valid.

### GitLab CI

Intended stages:

1. lint: frontend TypeScript and backend build with warnings as errors;
2. test: frontend and backend tests;
3. build: frontend Vite and backend publish;
4. publish: Podman image build/push;
5. deploy UAT: automatic on `uat`;
6. deploy production: manual gate on `main`.

Lint, test and build run on all branches. Publish runs only for release/non-production integration branches. Non-production deploy is automatic from its integration branch; production deploy is a manual gate from the main branch. Path filters avoid rebuilding an unchanged frontend or backend. Deployment uses `helm upgrade --install --atomic --wait` with a bounded timeout so an unready release rolls back automatically. Registry credentials, cluster configuration and environment API base URLs are protected CI variables; this document intentionally omits real values.

Path-based rules are intended to avoid rebuilding unchanged workloads. Cluster credentials and environment-specific API URLs are CI/CD variables. Verify variable names against the actual `.gitlab-ci.yml` before reproducing the pipeline because documentation uses both `KUBECONFIG_*` and `KUBE_CONFIG_*` forms.

Manual deployment builds local images, pushes them to an ACR, ensures namespace/secrets, and runs `helm upgrade --install --atomic`; `RUN_MIGRATIONS=true` enables the migration step in the helper script.

Supported development modes are frontend-only fixtures, backend standalone with user-secret configuration, and full-stack container composition. The current composition file is incomplete as noted in section 21; a rebuild must enable frontend, API and SQL services together before documenting the full-stack command as operational.

---

## 18. Testing and quality requirements

- Backend unit tests: xUnit/Moq project skeleton; engines and services are the primary unit-test targets.
- Backend integration tests: WebApplicationFactory plus Testcontainers SQL Server, currently skeleton.
- Frontend test command/configuration is not currently defined in `frontend/package.json`.
- Shared coverage JSON fixtures are intended to execute against both TypeScript and C# engines.
- CI must run strict typecheck, backend build/test, frontend tests and production builds.
- API errors must use RFC 7807.
- Published assignment concurrency must use `rowversion` and return 409 on conflicts.
- Desktop-first target: smooth rendering for a representative full roster across 31 days; usable at 1024px.
- Grid must support keyboard navigation and ARIA labels for role badges.
- Never mutate published assignments directly from the client.

The source documents do not choose a frontend test runner, component-test library or browser E2E tool. Select supported tools during rebuild and record the decision; the behavioral test requirements below are mandatory regardless of framework.

Required test coverage includes:

- coverage engine: complete coverage, one/multiple gaps, over-coverage, duplicate person/date, ineligible role and invalid/expired comp-off;
- rotation: eligibility, absence, 90-day fairness, recency and maximum-weekend targets;
- comp-off: before/after windows, excluded weekdays, occupied dates, separate Saturday/Sunday earnings and pending approval;
- auto-populate: defaults, rotating roles, weekends, holidays, locked assignments and 92-day rejection;
- validators and entity/DTO mapping round trips;
- role resolution using mock claims/mappings, grant expiry and deny precedence;
- full HTTP-to-database happy paths for every controller;
- publish transaction success, rollback, conflict and Admin force behavior;
- authorization matrix proving Viewer cannot write, scoped Planner cannot cross regions and Planner cannot use Admin endpoints;
- frontend page states, draft undo/cancel/review, keyboard operation, filter persistence and failed-publish draft retention; and
- end-to-end fixture parity between client and server coverage engines.

---

## 19. Suggested rebuild order

1. Create the monorepo and align package/runtime versions with the dependency manifests.
2. Implement the SQL schema, EF configurations and initial migration; choose `shift` or `shiftomator` consistently.
3. Seed region, shift, day-config, role and holiday configuration.
4. Implement pure coverage, rotation, comp-off and auto-populate engines and shared fixtures.
5. Implement services, DTOs, validation, transaction publishing, audit history and optimistic concurrency.
6. Implement all documented API endpoints and add database-backed health readiness.
7. Configure the Entra app registration, API scope, audience, group claims and Graph group-overage fallback.
8. Implement the SPA shell, auth guard, stores, API client and mock/live switch.
9. Implement the planning grid and draft UX first, then dashboard, timeline, day drill-down and administration views.
10. Replace direct fixture imports with stores/API paths and reconcile server/client coverage results.
11. Add unit, integration, frontend and end-to-end tests.
12. Fix container/compose builds, generate the EF migration bundle, validate Helm templates and deploy to a disposable namespace before UAT.

---

## 20. Workbook-derived operational detail and anonymized examples

The repository includes scheduling-workbook examples under the frontend fixture assets. They show representative spreadsheet layout, terminology, status values, staffing patterns, time-zone display, weekend rotation and holiday handling that the application replaces. This document intentionally omits original workbook filenames.

### Privacy and example policy

The examples in this section preserve representative workbook structures, codes, statuses and operational relationships, but contain no source names, initials, employee numbers or identity-like values. People use generic labels such as `Person 01`. Use stable non-production IDs such as `person-apac-001` in fixtures.

### Workbook inventory

#### Workbook A — rota and staffing patterns

Observed sheet types include monthly rotas, a Sunday rotation, a staff list, a blank template, current and retired weekend rotas, holiday coverage, daily role definitions and regional role definitions. Source sheet names are intentionally omitted.

The monthly sheets use a matrix: location in column A, person in column B, then one column per calendar date. Rows near the top summarize daily headcount by broad region (`APAC`, `General-India`, `EMEA`, `Americas`). The workbook contains both role codes and status codes in the same cells.

The staff-list sheet is a person master table with these conceptual columns: `Location`, `Display Name`, `Employee ID`, `Initials`, `Shift`, `Role`, `Default Week`, `Default Entry`, `Include`, `Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`. This maps directly to the `People` and `PersonEligibleRoles` model, with the weekday columns acting as source defaults/availability patterns. Any employee ID in examples must be a placeholder.

The `TEMPLATE` sheet is a blank monthly planning grid with the same date columns and region summary rows. It is the spreadsheet equivalent of the web Planning Grid before assignments are entered.

The `APAC Sunday MC` sheet is a rotation table: Sunday dates across columns, people down rows, and a marker such as `1` indicating the person selected for that Sunday’s `MC`/morning-check duty.

The `Amer Weekends` sheet is a weekend rota table with columns `Day & Date`, `Primary`, `Secondary`, `Service Transition`, `On-Call`, `Shadow/Trainee` and `BCM`. It uses one row per date, including separate Saturday and Sunday rows. The older `Amer Weekends RETIRED` sheet groups weekend pairs and includes `Primary`, `On-Call`, Saturday/Sunday secondary-shadow columns, `Shadow`, `BCM` and `Secondary On-Call`.

The holiday sheets contain a horizontal holiday calendar followed by person/location rows. A cell containing `Amer` marks that the person is assigned to work the holiday; additional columns summarize `Amer` and `OnCall S3` counts. The application should normalize this into `Holiday` records plus ordinary assignments, not retain the spreadsheet’s wide layout.

#### Workbook B — shifts and handovers

Observed sheets include `Weekday Shifts` and `Weekend Shifts`. They are visual time-zone charts rather than assignment matrices. The horizontal axis is represented by Excel fractional-day values; labels show local time bands. The sheets document work/off-work bands, regional handovers and core shift details.

### Canonical status vocabulary found in workbooks

The import/parser and UI should recognize case-insensitively and normalize these values:

| Workbook value(s)                                            | Normalized meaning                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M`                                                          | APAC morning standard shift.                                                                                                                                                            |
| `G`                                                          | General-India / APAC mid shift.                                                                                                                                                         |
| `E`                                                          | EMEA standard/global queue shift.                                                                                                                                                       |
| `BM`, `BM-Lead`                                              | Batch monitoring and batch-monitoring lead.                                                                                                                                             |
| `Amer`                                                       | AMER weekday/holiday work marker.                                                                                                                                                       |
| `Lead`, `Lead-E`                                             | AMER shift lead, weekday or Friday pattern.                                                                                                                                             |
| `Crew`, `Crew-E`, `Crew-L`, `Crew-BC`                        | AMER incident-crew variants.                                                                                                                                                            |
| `Batch-E`, `Batch-L`, `Batch-U`                              | AMER batch early, late and understudy variants.                                                                                                                                         |
| `Cover`                                                      | Flexible coverage/resource role, normally 0–3 people.                                                                                                                                   |
| `Primary`, `Secondary`, `Wknd ST`, `Wknd SU`, `ST`, `Shadow` | Weekend service roles. `Wknd ST` and `Wknd SU` are source labels for weekend Saturday/Sunday service-transition coverage and must not be confused with `ST` as a generic role.          |
| `Off`, `W-Off`, `woff`                                       | Planned day off; preserve the source label as an optional note but normalize the role/status to `Off`.                                                                                  |
| `0`                                                          | Non-working day/no assignment, commonly used for weekends in monthly matrices.                                                                                                          |
| `PH`                                                         | Public holiday.                                                                                                                                                                         |
| `C-Off`, `c-off`, `coff`, `Comp-Off`, `compff`               | Compensatory day off; normalize to `Comp-Off` and retain the original value in import metadata.                                                                                         |
| `OnCall`, `OnCall S3`                                        | On-call assignment; severity-specific forms should remain distinct role codes.                                                                                                          |
| `sick`, `Training`                                           | Absence/activity annotations appearing in source schedules. These are not in the current core enum and require either an `AssignmentStatus`/absence model or an extensible status code. |

Do not silently treat `0`, `Off`, `PH`, `Comp-Off`, absence and ordinary role assignments as the same thing. They affect coverage, eligibility, rotation and comp-off calculations differently.

### Synthetic staff master example

This is a generic fixture derived from the staff-list concepts. It demonstrates required fields and regional distribution without human-like names or source identifiers.

| id                | display name | location  | region/shift     | role        | default week | default entry | included | eligible roles                  |
| ----------------- | ------------ | --------- | ---------------- | ----------- | ------------ | ------------- | -------: | ------------------------------- |
| `person-apac-001` | Person 01    | Singapore | APAC / Singapore | Support     | M-F          | M             |        1 | M, MC                           |
| `person-apac-002` | Person 02    | Pune      | APAC / APAC      | Support     | M-F          | M             |        1 | M, MC                           |
| `person-apac-003` | Person 03    | Singapore | APAC Mid         | Support/SRE | M-F          | G             |        1 | G                               |
| `person-emea-001` | Person 04    | Pune      | EMEA / EMEA      | Support     | M-F          | E             |        1 | E, BM                           |
| `person-emea-002` | Person 05    | London    | EMEA / EMEA      | Support     | M-F          | E             |        1 | E, Shift-Lead                   |
| `person-amer-001` | Person 06    | Chicago   | AMER / Amer      | Support     | M-F          | Crew          |        1 | Crew, Lead, Batch-E, Batch-L    |
| `person-amer-002` | Person 07    | New York  | AMER / Amer      | Support     | M-F          | Crew-BC       |        1 | Crew-BC, Crew-E, Crew-L         |
| `person-amer-003` | Person 08    | Hartford  | AMER / Amer      | ST          | M-F          | ST Amer       |        1 | ST Amer, ST, Primary, Secondary |

For a full demo fixture, create enough generic staff records to exercise multi-region and multi-time-zone behavior. Use only sequential labels and non-production identifiers; do not reproduce a source roster or source employee identifiers.

### Synthetic monthly schedule example: May 2026

The representative monthly sheet has date columns for 1–23 May in the inspected range. The following compact sample demonstrates scheduling patterns and statuses with generic people. `0` means an explicitly marked non-working day.

| location  | synthetic person | May 1  | May 2 | May 3 | May 4  | May 5    | May 6    | May 7  | May 8 | May 9 | May 10 | May 11 | May 12 | May 13 | May 14 | May 15 |
| --------- | ---------------- | ------ | ----- | ----- | ------ | -------- | -------- | ------ | ----- | ----- | ------ | ------ | ------ | ------ | ------ | ------ |
| Singapore | Person 01        | PH     | 0     | 0     | M      | M        | M        | M      | M     | 0     | 0      | Off    | M      | M      | M      | M      |
| Singapore | Person 02        | M      | M     | M     | W-Off  | M        | M        | M      | M     | 0     | 0      | M      | M      | M      | M      | W-Off  |
| Pune      | Person 03        | M      | M     | M     | M      | M        | M        | M      | M     | 0     | 0      | M      | M      | M      | M      | M      |
| Pune      | Person 04        | E      | E     | E     | E      | Comp-Off | Comp-Off | 0      | 0     | E     | E      | E      | E      | E      | E      | BM     |
| Pune      | Person 05        | E      | E     | E     | E      | 0        | 0        | E      | E     | E     | E      | E      | E      | BM     | BM     | E      |
| Chicago   | Person 06        | Amer   | 0     | 0     | Amer   | Amer     | Amer     | Amer   | 0     | 0     | Amer   | Amer   | Amer   | Amer   | Amer   | Amer   |
| New York  | Person 07        | Lead-E | 0     | 0     | Crew-E | Crew-E   | Crew-L   | Crew-L | 0     | 0     | Crew-E | Crew-E | Crew-L | Crew-L | 0      | 0      |

The actual workbook also contains examples of `PH` followed by `0`, `Off` blocks, comp-offs adjacent to ordinary work, weekend-service labels, `oncall`, `woff`, and `Training`. The UI must display these as distinct cell states with tooltips and source notes.

### Synthetic monthly schedule example: June 2026

The June sheet demonstrates a full month matrix beginning June 1. It contains two explicit weekend columns represented by `0` in many rows, regular weekday assignments, holiday/absence exceptions, and comp-off blocks.

| location  | synthetic person | Jun 1 | Jun 2    | Jun 3 | Jun 4   | Jun 5    | Jun 6 | Jun 7 | Jun 8 | Jun 9 | Jun 10  | Jun 11  | Jun 12 | Jun 13 | Jun 14 | Jun 15 |
| --------- | ---------------- | ----- | -------- | ----- | ------- | -------- | ----- | ----- | ----- | ----- | ------- | ------- | ------ | ------ | ------ | ------ |
| Singapore | Person 01        | M     | M        | Off   | M       | M        | 0     | 0     | M     | M     | M       | M       | M      | 0      | 0      | M      |
| Singapore | Person 02        | M     | Comp-Off | M     | M       | M        | 0     | 0     | M     | M     | M       | M       | M      | 0      | 0      | M      |
| Pune      | Person 03        | M     | M        | M     | M       | M        | 0     | 0     | M     | M     | M       | M       | M      | 0      | 0      | M      |
| Pune      | Person 04        | E     | E        | BM    | E       | E        | 0     | 0     | E     | E     | E       | BM      | E      | 0      | 0      | E      |
| Pune      | Person 05        | Off   | Off      | Off   | Off     | Comp-Off | 0     | 0     | G     | G     | G       | G       | G      | 0      | 0      | G      |
| Chicago   | Person 06        | Lead  | Crew     | Crew  | Batch-E | Batch-L  | 0     | 0     | Lead  | Crew  | Batch-E | Batch-L | Cover  | 0      | 0      | Lead   |

This sample is illustrative of the source layout, not a new business rule. The rebuild should include machine-readable fixtures for the same cases and validate them through coverage and rotation tests.

### Synthetic APAC Sunday MC rotation example

The source `APAC Sunday MC` sheet marks one person per Sunday. A normalized representation is:

| date       | role code | person    | selected |
| ---------- | --------- | --------- | -------: |
| 2026-04-05 | MC        | Person 01 |        1 |
| 2026-04-12 | MC        | Person 02 |        1 |
| 2026-04-19 | MC        | Person 03 |        1 |
| 2026-04-26 | MC        | Person 01 |        1 |
| 2026-05-03 | MC        | Person 02 |        1 |
| 2026-05-10 | MC        | Person 03 |        1 |

The rotation engine should produce the same one-person-per-Sunday result while considering eligibility, prior 90-day counts, recency and blackout/availability data.

### Synthetic AMER weekend rota example

The source `Amer Weekends` sheet uses separate rows for Saturday and Sunday. Preserve that granularity in the database even if the UI groups them visually.

| date       | Primary   | Secondary | Service Transition | On-Call | Shadow/Trainee | BCM |
| ---------- | --------- | --------- | ------------------ | ------- | -------------- | --- |
| 2026-04-11 | Person 06 | —         | —                  | —       | Person 08      | —   |
| 2026-04-12 | Person 06 | —         | —                  | —       | Person 08      | —   |
| 2026-04-18 | Person 07 | —         | —                  | —       | —              | —   |
| 2026-04-19 | Person 07 | —         | —                  | —       | —              | —   |
| 2026-04-25 | Person 08 | Person 06 | Person 06          | —       | —              | —   |
| 2026-04-26 | Person 08 | Person 06 | Person 06          | —       | —              | —   |
| 2026-05-02 | Person 01 | —         | —                  | —       | Person 03      | —   |
| 2026-05-03 | Person 01 | —         | —                  | —       | Person 03      | —   |

For each weekend work assignment, generate or request a comp-off according to the region rules. A Saturday and Sunday assignment are two separate work events and may result in two separate comp-off links.

### Synthetic holiday example

The source `2026 US Holidays` sheet contains holiday dates/names and person-level `Amer` or `OnCall S3` markers. Normalize it as follows:

| date       | holiday             | location scope | person    | assignment/status | role/count context                                   |
| ---------- | ------------------- | -------------- | --------- | ----------------- | ---------------------------------------------------- |
| 2026-05-25 | Memorial Day        | US locations   | Person 06 | Amer              | AMER holiday coverage                                |
| 2026-05-25 | Memorial Day        | US locations   | Person 07 | Amer              | AMER holiday coverage                                |
| 2026-07-04 | US Independence Day | US locations   | Person 08 | Amer              | AMER holiday coverage                                |
| 2026-11-26 | US Thanksgiving Day | US locations   | Person 06 | Amer              | AMER holiday coverage                                |
| 2026-11-26 | US Thanksgiving Day | US locations   | Person 07 | OnCall S3         | severity-tier on-call                                |
| 2026-12-25 | Christmas Day       | US locations   | —         | PH                | no ordinary assignment unless coverage is configured |

The date/name/location holiday record and the person assignment are separate concepts. `PH` identifies a holiday state for a person/location; `Amer` identifies that the person works coverage on the holiday.

### Role definitions and timings from `Amer Daily Roles 2026`

The workbook gives operational descriptions in addition to short codes. Store the description and timing as role metadata so the UI can show it in a role palette, tooltip and settings page.

#### AMER Monday–Thursday

| code      | staffing | source timing                                                    | operational purpose                                                                                    |
| --------- | -------: | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Crew`    |        2 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Monitor incident queue, resolve/escalate requests and run incident channels with lead and batch staff. |
| `Crew-BC` |        1 | 08:00–17:00 CT / 09:00–18:00 ET                                  | Late coverage for end-of-day processing; monitor incidents and alerts.                                 |
| `Lead`    |        1 | source duty around 09:45–18:45 CT; winter display 09:00–18:00 CT | Oversee shift, escalations, communications, EMEA handover and Singapore handover.                      |
| `Batch-E` |        1 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Early batch monitoring and alert handling.                                                             |
| `Batch-U` |        1 | 08:00–17:00 CT / 09:00–18:00 ET                                  | Batch understudy, specifically associated with the New York team in the source description.            |
| `Batch-L` |        1 | source duty around 09:45–18:45 CT; winter display 09:00–18:00 CT | Late batch monitoring, end-of-day/APAC-start batch and secondary incident support.                     |
| `Cover`   |      0–3 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Flexible incident/alert coverage or SRE, automation and improvement work.                              |

#### AMER Friday

| code      | staffing | source timing                                                    | operational purpose                                                              |
| --------- | -------: | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Lead-E`  |        1 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Morning lead; receives EMEA handover and hands over to late crew.                |
| `Crew-E`  |      1–3 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Early incident crew.                                                             |
| `Crew-L`  |        1 | source duty around 11:00–19:45 CT; winter display 10:00–18:45 CT | Late incident crew/late lead; takes over lead duties and prepares Pune handover. |
| `Batch-E` |        1 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Friday primary batch monitoring.                                                 |
| `Batch-L` |        1 | source duty around 11:00–19:45 CT; winter display 10:00–18:45 CT | Late batch support and Pune handover.                                            |
| `Cover`   |      0–3 | 09:00–18:00 CT / 10:00–19:00 ET                                  | Flexible coverage or improvement work.                                           |

All weekday timings include a one-hour break according to the workbook. Do not infer exact paid hours solely from start/end time; store `breakMinutes=60` and calculate net hours.

#### AMER weekend timings

The workbook specifies winter display times of approximately Saturday 10:30–18:45 CT / 11:30–19:45 ET and Sunday 10:30–17:45 CT / 11:30–18:45 ET. The source duty text also shows approximately one hour later in some timing columns (`11:30` starts). Preserve both configured display timing and source notes if importing historical spreadsheets.

#### Zurich/CH roles

The `CH Daily Roles 2025` sheet defines:

| code       | hours CET            | purpose                                      |
| ---------- | -------------------- | -------------------------------------------- |
| `CH-Early` | 08:00–17:00          | Swiss-region morning checks.                 |
| `CH-SL`    | 09:00–18:00          | Swiss queue and monitoring lead.             |
| `CH-Late`  | 09:00–18:00          | Status reporting and late duties.            |
| `CH-OC`    | 18:00–08:00 next day | Night/weekend/bank-holiday on-call.          |
| `CH-OC-Mo` | 00:00–08:00          | On-call until EMEA morning.                  |
| `CH-OC-Ev` | 18:00–08:00 next day | Evening/night on-call.                       |
| `CH`       | no fixed hours       | General incident/universal-request handling. |
| `E`        | configured           | Global queue work.                           |
| `Off`      | —                    | Day off.                                     |
| `Comp-Off` | —                    | Compensatory time off.                       |
| `0`        | —                    | Non-working day.                             |

### Time-zone and handover data model from workbooks

The time charts distinguish a fixed/no-DST view and an AMER-DST view. Implement time handling with IANA zones and local shift times, not by storing Excel fractions:

| source label       | region/location | source offset context                                           |
| ------------------ | --------------- | --------------------------------------------------------------- |
| UK / GMT           | EMEA            | UTC, with UK summer offset represented separately in the chart. |
| Zurich             | EMEA            | UK +1 in the chart.                                             |
| India (EMEA shift) | EMEA            | UK +5:30.                                                       |
| Chicago            | AMER            | UK −6 in no-DST chart.                                          |
| New York           | AMER            | UK −5 in no-DST chart.                                          |
| India (AMER shift) | AMER            | UK +5:30.                                                       |
| Singapore          | APAC            | UK +8.                                                          |
| Beijing            | APAC            | UK +8.                                                          |
| Tokyo              | APAC            | UK +9.                                                          |
| India (APAC shift) | APAC            | UK +5:30.                                                       |

The chart labels handovers in three zones: APAC→EMEA, EMEA→AMER and AMER→APAC. Store each handover with `fromRegion`, `toRegion`, local/UTC display time, overlap duration and optional DST adjustment, then calculate rendered positions for the selected date.

### Spreadsheet import requirements

Spreadsheet import is an optional migration/roadmap capability derived from operational workbook analysis; it has no endpoint or committed implementation phase in the source design documents. It is not required for the core rebuild unless explicitly commissioned. If included, it must:

1. detect workbook/sheet type by headers, not filename alone;
2. convert Excel serial dates to ISO dates;
3. transpose wide monthly matrices into one assignment/status row per person/date;
4. resolve names to pre-registered person IDs without carrying source employee identifiers into demo fixtures;
5. normalize case and aliases for status/role codes;
6. preserve unrecognized cell values in `notes` or an import-warning table;
7. distinguish blank, `0`, `Off`, `PH`, `Comp-Off`, absence and ordinary roles;
8. import weekend primary/secondary/service-transition/on-call/shadow columns as separate assignments;
9. import holiday definitions separately from holiday work assignments;
10. import role descriptions and timing metadata from daily-role sheets;
11. report duplicate person/date assignments and unknown people before publish; and
12. load imported data into a draft session for review, never directly into published assignments.

### Required fixtures derived from workbook scenarios

The rebuild should include fixture cases for normal APAC `M` and `G` weekday coverage; EMEA `E`, `BM` and Zurich `CH-*` duties; AMER Mon–Thu and Friday role patterns; separate Saturday/Sunday weekend assignments; a person with two weekend duties and two linked comp-offs; a public holiday with `PH` for non-working staff and `Amer`/`OnCall S3` for coverage staff; `Off`, `W-Off`, `0`, `Training` and `sick` cell values; APAC Sunday `MC` rotation; AMER DST transition display; APAC→EMEA, EMEA→AMER and AMER→APAC handovers; and an unknown spreadsheet code that produces an import warning rather than an invalid assignment.

## 21. Explicit gaps to preserve or resolve

These are repository facts, not assumptions:

- No EF migrations are present.
- Current backend projects target .NET 10/package major 10 while design documents and Docker stages target .NET 8; align the runtime baseline.
- Database schema name in code (`shiftomator`) differs from documented schema (`shift`).
- EF migration assembly references a nonexistent separate Infrastructure project.
- Production Entra audience/scope/group configuration is incomplete.
- Frontend does not request `ShiftOMator.Access`.
- Microsoft Graph fallback for Entra group overage is absent.
- Some frontend pages bypass live stores and display fixtures.
- `compose.yaml` has MSSQL and frontend services commented out while backend depends on MSSQL.
- Current `RegionsController` exposes fewer operations than the API design document.
- Current `CoverageController` has no `/coverage/now` operation.
- Current Holidays query parameters (`from`, `to`, `location`) differ from the older contract (`year`, optional `location`); choose and document one contract.
- Backend test projects and frontend testing are incomplete.
- Frontend test tooling is not selected in the source documents.
- Export, notifications and some administration/timeline features are planned or stubbed.
- Spreadsheet import has operational requirements but no committed API or implementation phase; it remains optional.
- The one-assignment-per-person/date constraint cannot represent simultaneous ordinary and on-call duties without a separate duty model or revised uniqueness rule.
- `sick`, `Training` and other non-working/activity codes need an explicit status model or documented extensible-code policy before import and coverage behavior can be authoritative.
- Health readiness currently has no registered DB check.
- Documentation contains inconsistent port claims: frontend Vite script uses port 3000, while README/containers use 4200; use the actual script/container configuration for the chosen environment.

For a rebuild, resolve these items deliberately rather than silently reproducing an inconsistent or nonfunctional state.

---

## 22. Source-of-truth files

Use these files for implementation detail and contract verification:

- `docs/design/overview.md`: product, regions, roles and business rules.
- `docs/design/frontend.md`: UX, views, stores and frontend requirements.
- `docs/design/backend.md`: backend layering, engines, auth and cross-cutting concerns.
- `docs/database.md`: intended database schema and relationships.
- `docs/api-contracts.md`: endpoint paths, authorization and JSON examples.
- `docs/devops.md`: containers, CI/CD, Helm, AKS and migrations.
- `docs/plan-frontend.md`: implementation phases, planned UI interactions, reports and backend-switch milestones.
- `docs/plan-backend.md`: implementation phases, validation, endpoint, performance and test acceptance details.
- `frontend/src/`: current SPA implementation.
- `backend/src/`: current API/domain implementation.
- `charts/shift-o-mator/`: current Kubernetes deployment templates.
- `compose.yaml`, `backend/Dockerfile`, `frontend/Dockerfile`, `.gitlab-ci.yml`: current executable deployment definitions.

### Documentation consolidation coverage

| Source document           | Durable content incorporated here                                                                                                | Main destination           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `docs/design/overview.md` | Problem, users, regional structure, roles, requirements, comp-off, rotation, DST, holidays and core workflows                    | Sections 1, 5–7, 13        |
| `docs/design/frontend.md` | Libraries, shell, routes, grid/timeline/day/dashboard UX, draft signals, stores, types, services and non-functional requirements | Sections 2–4, 9–12         |
| `docs/design/backend.md`  | Runtime/layers, engines, services, security, validation, logging, errors, health, concurrency and frontend migration             | Sections 11–15, 18–19      |
| `docs/database.md`        | Tables, relationships, constraints, JSON shapes, concurrency and migration approach                                              | Sections 6 and 15–17       |
| `docs/api-contracts.md`   | Routes, policies, filters, status codes, request/response semantics, publish and health behavior                                 | Section 14                 |
| `docs/devops.md`          | Images, pipeline stages/triggers, Helm structure, secrets pattern, migration Job and local modes                                 | Sections 16–18             |
| `docs/plan-frontend.md`   | Planned drag/bulk/fill, suggestions, locks, admin screens, reports, accessibility and integration milestones                     | Sections 3–5, 9, 12, 18–19 |
| `docs/plan-backend.md`    | Validators, suggestion API, performance/rate limits, observability, tests and integration milestones                             | Sections 14, 18–19         |

Sprint numbering, status icons and repeated command snippets are project-management metadata and are intentionally represented by the single rebuild order in section 19 rather than duplicated. Sanitized examples replace source identities, private package names, hosts and credentials. Known disagreements between documents and executable code are retained in section 21 instead of silently choosing an unverified behavior.
