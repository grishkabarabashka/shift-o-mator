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
mixing shifts and statuses in the same cells. If built, it must:

1. detect workbook and sheet type by headers, not filename;
2. convert spreadsheet serial dates to ISO dates;
3. transpose wide monthly matrices into one row per person and date;
4. resolve names to pre-registered stable person IDs, never carrying source employee
   identifiers into fixtures;
5. normalize case and aliases;
6. preserve unrecognized values in `notes` or an import-warning table;
7. **distinguish blank, `0`, `Off`, `PH`, `Comp-Off`, absence and ordinary shifts** —
   these affect coverage, eligibility, rotation and comp-off differently;
8. import weekend Primary / Secondary / ST / On-Call / Shadow columns as separate
   assignments;
9. import holiday definitions separately from holiday work assignments;
10. import shift descriptions and timings from the daily-duty sheets;
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
| `Primary`, `Secondary`, `Wknd ST`, `Wknd SU`, `ST`, `Shadow` | Weekend service shifts. `Wknd ST`/`Wknd SU` are Saturday/Sunday service-transition cover and are **not** the generic `ST` shift. |
| `Off`, `W-Off`, `woff`, `0` | No shift. The markers these used to import as are deleted ([ADR-0052](adr/0052-two-flows-drafts-for-shifts-approval-for-everything-else.md)); an engineer declaring themselves unavailable records the `UNAVAILABLE` event type instead. |
| `PH` | Public holiday |
| `C-Off`, `c-off`, `coff`, `Comp-Off`, `compff` | → `Comp-Off`, original value kept in import metadata |
| `OnCall`, `OnCall S2`, `OnCall S3` | On-call; severity-specific forms stay distinct shift codes. An ordinary duty occupying the day — never layered on top of another. |
| `sick` | `Absence` of type `SICK` |
| `Training` | → the **`Cover`** shift, not an absence. In-hours training is engineering work and the person is at work, so the day **counts toward coverage**. ([ADR-0017](adr/0017-absence-range-cell-projection.md)) |

Unknown codes produce an **import warning requiring a mapping decision**, never a
silently accepted shift.


## Holiday import

The other real external source, and the only one that is a feed rather than a paste.
`POST /api/admin/holidays/import` reads an iCalendar document — pasted, uploaded, or
fetched from a host on the allowlist (`AllowedCalendarHost`, managed at Settings →
Maintenance) — and **adds days that are missing, never removing one**.

Not removing is the whole design, not a shortcut. A sync would have to answer "the feed
dropped a day people are already rostered off for", and there is no safe automatic answer
to that: the roster is already built on the old fact. A scheduler and that answer are both
missing, so this is deliberately an import that a person runs and reviews.

The allow-list exists because the endpoint fetches a URL the caller supplies, which is a
server-side request forgery primitive if it is left open.

## Reverse flow to HR

Double entry can't be eliminated without an API, but it can be reduced to a checklist:

- source of truth for **planning** is this product; for **leave** it is the corporate
  system;
- a "to be filed" screen lists comp days and confirmed absences not yet recorded
  upstream, with copy-to-clipboard in the right format and a "filed" mark;
- `syncedToHrAt` makes discrepancies visible continuously instead of at quarter end;
- if a programmatic route ever appears, only the transport changes.

## Calendar

ICS, and it is built ([ADR-0055](adr/0055-a-personal-calendar-and-a-feed.md)). An engineer
subscribes once and sees their shifts in Outlook, including comp days and absences.

- `GET /api/me/calendar-feed` hands the signed-in person their own subscription URL, and
  `POST /api/me/calendar-feed/reset` mints a new token when they want the old one dead.
- `GET /api/calendar/{token}.ics` is the feed itself, and it is **anonymous by necessity**:
  a subscribing calendar client cannot carry a bearer token. `Person.CalendarToken` is the
  whole of its authentication — hence 256 bits, `[JsonIgnore]` so `/api/reference` cannot
  hand out everybody's, replacement of the fixture's guessable `tok-{personId}` on every
  start, and a reset button beside the copy button. A wrong token answers 404 exactly as an
  unknown route does.

It is one of **exactly two** anonymous routes, and both are anonymous because the caller
provably cannot have a token yet; the other is `GET /api/setup/state`
([ADR-0059](adr/0059-setup-is-a-screen-not-a-flag.md)). Adding a third needs the same
argument.

Events carry the shift window in the shift's timezone, with the shift code and long name
in the summary.

## Export

XLSX and CSV for people who will keep looking at spreadsheets, print/PDF for the
monthly rota, and full-state JSON for debugging and for carrying data out of the MVP.
Every export names its display timezone.
