# Roadmap

## Where the code actually is

The first implementation pass built stages 1–6 of the previous plan against a model
that has since been corrected. What survives, what changes and what is thrown away:

| Built | Status after the redesign |
|---|---|
| `domain/types.ts` | **Rework.** Needs Region + PlanningUnit as separate axes, Shift, DayConfiguration with effective dating, the marker-vs-role split, draft entities, cell projection. |
| `domain/fixtures.ts` | **Replace.** Invented `SL`/`BATCH`/`CAVA` codes; real codes and minimums are now known. |
| `engine/dates.ts` | **Keep**, extend with handover and DST helpers. |
| `engine/coverage.ts` | **Rework.** Needs day configurations and a `THIN` level. |
| `engine/compDays.ts` | **Rework.** Window search instead of a fixed offset; no expiry, aging instead. |
| `engine/validate.ts` | **Keep the shape**, split gap and conflict categories. |
| `data/memoryRepository.ts` | **Rework.** Published/draft split, draft session methods. |
| `store/useSchedule.ts` | **Rework.** Patches become draft changes with a session. |
| Planning grid, coverage strip, issue panel | **Keep**, extend for grouping, zoom, markers, review. |
| Shell, top bar, context menu | **Keep.** |
| Period locking | **Delete.** Superseded by drafts (ADR-0015). |

## Stages

| # | Stage | Result | State |
|---|---|---|---|
| 1 | Corrected model and real fixtures | domain types, real roles/minimums/statuses, day configurations | done |
| 2 | Engine rework | coverage with day configs and thin, comp-off windows, cell projection, validation split | done |
| 3 | Draft sessions in the repository and store | published/draft split, changes, undo, review data | done |
| 4 | Schedule grid against the new model | grouping by category, markers, statuses, picker sections | done |
| 5 | **Coverage: aggregate row + per-role strip** | **the point where this beats the spreadsheet** | done |
| 6 | Review and publish | diff, impact summary, atomic publish, conflict reconciliation | done |
| 7 | Absences and comp days | range entry, window-based accrual, balance | done |
| 8 | Dashboard | summary, attention list, region minibars, jump-to-gap | done |
| 9 | People | table, KPIs, fairness, comp-off tiles, role mix | done |
| 10 | Settings | regions, shifts, day configurations, roles, holidays | **read-only**; editing waits on effective-dated versioning (ADR-0021) |
| 11 | Timeline and day drill-down | now marker, handover bands, hourly headcount, role sub-lanes | timeline done; day drill-down open |
| 12 | Zoom levels and long-range heatmap | day/2d/week/2w/month + 3/6-month read-only | done |
| 13 | Suggest and auto-populate | ranked candidates, locked cells, explanations | open |
| 14 | Absence import | paste, mapping, diff, impact, batches | open |
| 15 | Export | XLSX, CSV, ICS, print | open |
| 16 | Backend | .NET, EF Core, Entra, AKS, real concurrency | open |

Stage 5 remains the point at which the product is more useful than Excel. Stage 13
stays late deliberately: fairness computed over an empty history is noise.

Two decisions were taken during stages 8–12 and are recorded rather than folded in
silently: [ADR-0022](adr/0022-tailwind-for-tokens-and-layout.md) on the styling layer
and [ADR-0023](adr/0023-editing-arms-itself.md) on removing the explicit Edit mode.

## Sequencing notes

- Stages 1–3 are a single continuous rework; the app will not build in between. Do them
  as one branch.
- Stage 6 depends on 3. Do not build review UI against the patch model.
- Stage 8 (Dashboard) is the landing page most users will ever see, and it needs only
  published data plus the coverage engine — it can be built as soon as stage 2 lands.
- Stage 16 is the only stage that requires decisions outside this repository (Entra app
  registration, cluster, database).
