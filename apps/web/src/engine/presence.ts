/**
 * Where people work, projected onto grid cells (ADR-0043).
 *
 * WHY this is a separate module and not a branch inside `engine/cellValue.ts`:
 * `cellValue` resolves a *precedence chain* — shift beats absence beats comp day beats
 * holiday beats marker — and produces one winner per cell. Presence has no precedence
 * relationship with any of them: a person on `Crew` is also either remote or in an
 * office, and both facts are true at once. Folding it into that union would force every
 * `switch` on `CellValue.kind` to grow a case that means something unrelated.
 *
 * The projection is a second, independent map over the same cell keys, built alongside
 * the first. `cellValue.ts` is untouched by presence, which is the test of the design.
 */

import type {
  DayPortion,
  IsoDate,
  Location,
  PersonId,
  PresenceRecord,
  PresenceType,
} from '../domain/types.ts';
import { cellKey } from '../domain/lookup.ts';

/** What a cell should display for presence. */
export interface PresenceMark {
  /** NOTE: Which record produced this cell — what "clear this day" needs to delete. */
  readonly recordId: string;
  readonly typeId: string;
  readonly portion: DayPortion;
  readonly color: string;
  /** NOTE: True when this is where the person normally is — drawn quieter. */
  readonly atBaseline: boolean;
  /** NOTE: One or two characters for the cell band. */
  readonly glyph: string;
  /** NOTE: Full text, appended to the cell's tooltip and `aria-label`. */
  readonly label: string;
}

export interface PersonPresenceBaseline {
  readonly personId: PersonId;
  readonly defaultPresenceTypeId: string;
  readonly defaultSiteLocationId?: string | undefined;
}

/**
 * NOTE: What a record is drawn as when the type row behind it is not loaded.
 *
 * WHY it exists at all: the projection runs on whatever the client happens to hold, and a
 * record whose type has not arrived — or that names one an administrator deleted — still
 * has to render as *something*. A blank glyph would read as "nothing recorded", which is
 * the one thing it is not.
 *
 * It is deliberately anonymous. Guessing a colour and a name per id was possible while the
 * set was four fixed members; now that an administrator can add one, a guess would be a
 * different wrong answer for every installation.
 */
const UNKNOWN = { glyph: '?', color: 'var(--ink-faint)', label: 'Recorded, kind unknown' } as const;

const PORTION_SUFFIX: Record<DayPortion, string> = {
  FULL: '',
  MORNING: ' (morning)',
  AFTERNOON: ' (afternoon)',
};

/**
 * NOTE: Every recorded day produces a mark.
 *
 * This used to suppress anything matching the person's baseline, on the theory that
 * rendering it would put a glyph in all ~2500 cells. That was wrong about the data:
 * presence records are **sparse** — one exists only where somebody said so — so the rule
 * suppressed the only records there were. Marking "in the office" then appeared to do
 * nothing at all.
 *
 * The baseline still earns its place: it picks the office when you record one, and an
 * away-from-baseline day is drawn more strongly than a to-baseline one.
 */
export function markFor(
  record: PresenceRecord,
  baseline: PersonPresenceBaseline | undefined,
  locationName: (id: string) => string | undefined,
  /** The configured row for this way of working, when one is loaded. */
  type?: PresenceType | undefined,
): PresenceMark {
  const style = type ?? UNKNOWN;
  const site = record.siteLocationId ? locationName(record.siteLocationId) : undefined;

  const atBaseline =
    baseline !== undefined &&
    record.typeId === baseline.defaultPresenceTypeId &&
    (type?.namesALocation !== true || record.siteLocationId === baseline.defaultSiteLocationId);

  const detail = type?.namesALocation ? site : (record.siteLabel ?? undefined);
  return {
    recordId: record.id,
    typeId: record.typeId,
    portion: record.portion,
    color: style.color,
    atBaseline,
    // A non-baseline office names which one, so the glyph alone never has to be guessed at.
    glyph: type?.namesALocation && site && !atBaseline
      ? `${style.glyph}·${site.slice(0, 1)}`
      : style.glyph,
    label: `${detail ? `${style.label} — ${detail}` : style.label}${PORTION_SUFFIX[record.portion]}`,
  };
}

export interface PresenceProjection {
  /** NOTE: Keyed by `cellKey(personId, date)`, same as the cell projection. */
  readonly byCell: ReadonlyMap<string, PresenceMark>;
  /** NOTE: Per-date headcount by group, for the coverage strip's on-site/remote line. */
  readonly countsByDate: ReadonlyMap<IsoDate, PresenceCounts>;
}

export interface PresenceCounts {
  readonly onSite: number;
  readonly remote: number;
  readonly away: number;
}

/**
 * Expands presence ranges over `dates` into per-cell marks and per-day counts.
 *
 * The counts answer a per-day question — "how many are in the office on Friday" — which
 * the per-cell marks cannot, because reading a total off eighty cells is not reading.
 */
export function projectPresence(params: {
  readonly records: readonly PresenceRecord[];
  readonly dates: readonly IsoDate[];
  readonly baselines: readonly PersonPresenceBaseline[];
  readonly locations: readonly Location[];
  /** NOTE: Optional so a caller with no reference data still projects — see `UNKNOWN`. */
  readonly presenceTypes?: readonly PresenceType[] | undefined;
}): PresenceProjection {
  const { records, dates, baselines, locations, presenceTypes } = params;

  const baselineByPerson = new Map(baselines.map((b) => [b.personId, b]));
  const typeById = new Map((presenceTypes ?? []).map((t) => [t.id, t]));
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));
  const nameOf = (id: string): string | undefined => locationNames.get(id);

  const byCell = new Map<string, PresenceMark>();
  const countsByDate = new Map<IsoDate, { onSite: number; remote: number; away: number }>();
  for (const date of dates) countsByDate.set(date, { onSite: 0, remote: 0, away: 0 });

  for (const record of records) {
    const baseline = baselineByPerson.get(record.personId);
    const type = typeById.get(record.typeId);
    const mark = markFor(record, baseline, nameOf, type);

    for (const date of dates) {
      if (date < record.from || date > record.to) continue;

      // NOTE: Last writer wins per cell. Overlapping declarations for one person are a
      // data problem, not a rendering problem — and the alternative (dropping both)
      // would hide the fact entirely.
      byCell.set(cellKey(record.personId, date), mark);

      const counts = countsByDate.get(date);
      if (!counts) continue;
      // An unknown type counts as away: it is the answer that does not claim somebody is
      // in a building, which is the one that would mislead.
      if (type?.countsAs === 'ON_SITE') counts.onSite += 1;
      else if (type?.countsAs === 'REMOTE') counts.remote += 1;
      else counts.away += 1;
    }
  }

  return { byCell, countsByDate };
}
