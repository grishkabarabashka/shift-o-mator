# Integrations

## Absence import

The corporate leave system has no API; the export is produced by hand. This is the only
external data source, so import is a real feature, not a hack.

1. **Paste from the clipboard** into a table (Ctrl+V straight from an open spreadsheet)
   or upload a file. Pasting is faster and is the primary path.
2. **Column mapping** in the UI, saved as a named template. When the export format
   changes it's fixed in the UI, not in code.
3. **Person matching** by employee ID; failing that by name with suggestions and manual
   confirmation. Matches are remembered.
4. **Diff preview**: N added, M changed, K gone. "Gone" is the dangerous one — was the
   leave cancelled, or did the row simply not make it into this export? Missing records
   are flagged and require confirmation; they are never auto-deleted.
5. **Impact analysis before applying**: "these 4 absences overlap published shifts — 4
   assignments need a replacement", recomputing only affected days.
6. **Freshness indicator** in the header: "Absences current as of 12 Aug (3 days ago)".
   Without it, nobody knows in six months whether to trust the data.
7. Each import is a batch with one-click rollback.
8. Imported rows land in a **draft**, never directly in published data.

## Spreadsheet migration

Optional, and only if commissioned. The historical workbooks are wide monthly matrices
mixing roles and statuses in the same cells. If built, it must:

1. detect workbook and sheet type by headers, not filename;
2. convert spreadsheet serial dates to ISO dates;
3. transpose wide monthly matrices into one row per person and date;
4. resolve names to pre-registered stable person IDs, never carrying source employee
   identifiers into fixtures;
5. normalize case and aliases;
6. preserve unrecognized values in `notes` or an import-warning table;
7. **distinguish blank, `0`, `Off`, `PH`, `Comp-Off`, absence and ordinary roles** —
   these affect coverage, eligibility, rotation and comp-off differently;
8. import weekend Primary / Secondary / ST / On-Call / Shadow columns as separate
   assignments;
9. import holiday definitions separately from holiday work assignments;
10. import role descriptions and timings from the daily-role sheets;
11. report duplicate person/date cells and unknown people before publish;
12. load everything into a draft for review.

### Status vocabulary

Recognized case-insensitively and normalized:

| Source value(s) | Normalized meaning |
|---|---|
| `M` | APAC morning standard shift |
| `G` | General-India / APAC mid shift |
| `E` | EMEA standard / global queue |
| `BM`, `BM-Lead` | Batch monitoring, batch monitoring lead |
| `Amer` | AMER weekday or holiday work marker |
| `Lead`, `Lead-E` | AMER shift lead, weekday or Friday pattern |
| `Crew`, `Crew-E`, `Crew-L`, `Crew-BC` | AMER incident crew variants |
| `Batch-E`, `Batch-L`, `Batch-U` | AMER batch early, late, understudy |
| `Cover` | Flexible coverage, normally 0–3 people |
| `Primary`, `Secondary`, `Wknd ST`, `Wknd SU`, `ST`, `Shadow` | Weekend service roles. `Wknd ST`/`Wknd SU` are Saturday/Sunday service-transition cover and are **not** the generic `ST` role. |
| `Off`, `W-Off`, `woff` | Planned day off → marker `OFF`, source label kept as a note |
| `0` | Explicitly non-working → marker `NOT_SCHEDULED`, **not** the same as blank |
| `PH` | Public holiday |
| `C-Off`, `c-off`, `coff`, `Comp-Off`, `compff` | → `Comp-Off`, original value kept in import metadata |
| `OnCall`, `OnCall S2`, `OnCall S3` | On-call; severity-specific forms stay distinct role codes. An ordinary duty occupying the day — never layered on top of another. |
| `sick` | `Absence` of type `SICK` |
| `Training` | → the **`Cover`** role, not an absence. In-hours training is engineering work and the person is at work, so the day **counts toward coverage**. ([ADR-0017](adr/0017-absence-range-cell-projection.md)) |

Unknown codes produce an **import warning requiring a mapping decision**, never a
silently accepted role.

## Reverse flow to HR

Double entry can't be eliminated without an API, but it can be reduced to a checklist:

- source of truth for **planning** is this product; for **leave** it is the corporate
  system;
- a "to be filed" screen lists comp days and confirmed absences not yet recorded
  upstream, with copy-to-clipboard in the right format and a "filed" mark;
- `syncedToHrAt` makes discrepancies visible continuously instead of at quarter end;
- if a programmatic route ever appears, only the transport changes.

## Calendar

ICS. An engineer subscribes once and sees their shifts in Outlook, including comp days
and absences.

- MVP: export `.ics` for a period.
- Production: a stable per-person subscription URL keyed by `Person.calendarToken`,
  which is already in the model.

Events carry the role window in the role's timezone, with the role code and long name
in the summary.

## Export

XLSX and CSV for people who will keep looking at spreadsheets, print/PDF for the
monthly rota, and full-state JSON for debugging and for carrying data out of the MVP.
Every export names its display timezone.
