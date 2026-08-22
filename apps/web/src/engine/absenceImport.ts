/**
 * Absence import — paste/upload → column mapping → person matching → diff →
 * impact → a batch of draft changes (Docs/11 "Absence import").
 *
 * The corporate leave system has no API; a human exports a spreadsheet by
 * hand and the planner pastes or uploads it here. Every function below is
 * pure — the wizard in `features/absences` owns the step-by-step state
 * (which suggestion the planner picked, which "gone" record they confirmed)
 * and calls these in sequence. Nothing here touches the store or `Date.now`.
 */

import { absenceChange } from '../domain/draft.ts';
import type { DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  AbsenceType,
  Assignment,
  DateRange,
  DraftChange,
  IsoDate,
  IsoInstant,
  PersonId,
} from '../domain/types.ts';
import { parseDate, rangesOverlap } from './dates.ts';

// ---------------------------------------------------------------------------
// 1. Paste or upload → a plain grid of cells
// ---------------------------------------------------------------------------

/**
 * Splits pasted or uploaded text into rows of cells. Clipboard paste from a
 * spreadsheet is tab-separated; an uploaded `.csv` is comma-separated. Both
 * are accepted by sniffing whichever delimiter the first non-blank line
 * actually contains — a fixed choice would silently mis-split the other.
 */
export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
}

// ---------------------------------------------------------------------------
// 2. Column mapping
// ---------------------------------------------------------------------------

export type ImportField = 'personId' | 'personName' | 'type' | 'from' | 'to' | 'note' | 'ignore';

/** Column index → field. Persisted by the UI as a named template. */
export type ColumnMapping = Readonly<Record<number, ImportField>>;

export interface ParsedAbsenceRow {
  readonly rowIndex: number;
  readonly personIdRaw: string | undefined;
  readonly personNameRaw: string | undefined;
  readonly type: AbsenceType;
  readonly from: IsoDate | undefined;
  readonly to: IsoDate | undefined;
  readonly note: string | undefined;
  /** Set when the row can't produce a valid absence — surfaced, never silently dropped. */
  readonly error: string | undefined;
}

const TYPE_SYNONYMS: Readonly<Record<string, AbsenceType>> = {
  vacation: 'VACATION',
  annual: 'VACATION',
  'annual leave': 'VACATION',
  pto: 'VACATION',
  holiday: 'VACATION',
  leave: 'VACATION',
  sick: 'SICK',
  illness: 'SICK',
  medical: 'SICK',
  other: 'OTHER',
};

function normalizeType(raw: string | undefined): AbsenceType {
  if (!raw) return 'VACATION';
  return TYPE_SYNONYMS[raw.trim().toLowerCase()] ?? 'OTHER';
}

const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_DATE_RE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;

/**
 * ISO first, then day-first `D.M.YYYY` / `D/M/YYYY`. ASSUMPTION: the
 * corporate export's locale has not been confirmed against a real sample;
 * day-first matches the AMER/EMEA/APAC region set more often than not and is
 * cheap to change once one is seen. Every candidate is validated through
 * `parseDate`, so `31/02/2026` is rejected rather than silently wrapped.
 */
export function parseFlexibleDate(raw: string): IsoDate | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const iso = ISO_DATE_RE.exec(trimmed);
  const slash = SLASH_DATE_RE.exec(trimmed);
  const candidate = iso
    ? `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`
    : slash
      ? `${slash[3]}-${slash[2]!.padStart(2, '0')}-${slash[1]!.padStart(2, '0')}`
      : undefined;
  if (!candidate) return undefined;

  try {
    parseDate(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

const HEADER_HINTS: ReadonlyArray<readonly [RegExp, ImportField]> = [
  [/employee.?id|emp.?id|^id$/i, 'personId'],
  [/name/i, 'personName'],
  [/type|reason|category/i, 'type'],
  [/from|start/i, 'from'],
  [/to|end/i, 'to'],
  [/note|comment/i, 'note'],
];

/**
 * Best-effort default mapping from a header row, so the common case (a
 * spreadsheet with sane column names) needs zero clicks in the mapping step.
 * Never authoritative — the planner sees and can override every column.
 */
export function guessColumnMapping(header: readonly string[]): ColumnMapping {
  const mapping: Record<number, ImportField> = {};
  header.forEach((cell, index) => {
    const hint = HEADER_HINTS.find(([pattern]) => pattern.test(cell));
    mapping[index] = hint ? hint[1] : 'ignore';
  });
  return mapping;
}

function cellAt(row: readonly string[], mapping: ColumnMapping, field: ImportField): string | undefined {
  for (const [index, mapped] of Object.entries(mapping)) {
    if (mapped === field) return row[Number(index)]?.trim() || undefined;
  }
  return undefined;
}

/** Applies a column mapping to every row, skipping the header row if present. */
export function mapRows(
  table: readonly (readonly string[])[],
  mapping: ColumnMapping,
  hasHeader: boolean,
): ParsedAbsenceRow[] {
  const dataRows = hasHeader ? table.slice(1) : table;

  return dataRows.map((row, index) => {
    const personIdRaw = cellAt(row, mapping, 'personId');
    const personNameRaw = cellAt(row, mapping, 'personName');
    const fromRaw = cellAt(row, mapping, 'from');
    const toRaw = cellAt(row, mapping, 'to');
    const note = cellAt(row, mapping, 'note');
    const type = normalizeType(cellAt(row, mapping, 'type'));

    let error: string | undefined;
    if (!personIdRaw && !personNameRaw) error = 'no person in this row';

    const from = fromRaw ? parseFlexibleDate(fromRaw) : undefined;
    if (!error && fromRaw && !from) error = `unreadable date: "${fromRaw}"`;
    if (!error && !fromRaw) error = 'no start date';

    let to = toRaw ? parseFlexibleDate(toRaw) : from;
    if (!error && toRaw && !to) error = `unreadable date: "${toRaw}"`;

    // Same convention as the day strip: an inverted pair is a swap, not a
    // clamp — the source's two date columns, not their order, are the truth.
    let effectiveFrom = from;
    if (effectiveFrom && to && to < effectiveFrom) {
      const swapped = effectiveFrom;
      effectiveFrom = to;
      to = swapped;
    }

    return { rowIndex: index, personIdRaw, personNameRaw, type, from: effectiveFrom, to, note, error };
  });
}

// ---------------------------------------------------------------------------
// 3. Person matching
// ---------------------------------------------------------------------------

export interface PersonSuggestion {
  readonly personId: PersonId;
  readonly name: string;
  readonly score: number;
}

export interface PersonMatch {
  readonly rowIndex: number;
  /** Set when the row resolved without needing a planner decision. */
  readonly personId: PersonId | undefined;
  readonly suggestions: readonly PersonSuggestion[];
}

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Token overlap — deterministic, no fuzzy-matching library for ~80 names. */
function nameScore(a: string, b: string): number {
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Employee ID first; failing that, name with ranked suggestions. `remembered`
 * carries prior manual confirmations forward (keyed by the normalized raw
 * text the planner resolved last time) so a recurring export stops asking.
 */
export function matchPeople(
  rows: readonly ParsedAbsenceRow[],
  index: DatasetIndex,
  remembered: ReadonlyMap<string, PersonId>,
): PersonMatch[] {
  const people = [...index.people.values()];

  return rows.map((row) => {
    if (row.error) return { rowIndex: row.rowIndex, personId: undefined, suggestions: [] };

    const rememberKey = (row.personIdRaw ?? row.personNameRaw ?? '').trim().toLowerCase();
    const rememberedId = remembered.get(rememberKey);
    if (rememberedId) return { rowIndex: row.rowIndex, personId: rememberedId, suggestions: [] };

    if (row.personIdRaw) {
      const exact = people.find(
        (p) => p.employeeId?.trim().toLowerCase() === row.personIdRaw!.trim().toLowerCase(),
      );
      if (exact) return { rowIndex: row.rowIndex, personId: exact.id, suggestions: [] };
    }

    const nameRaw = row.personNameRaw ?? row.personIdRaw;
    if (!nameRaw) return { rowIndex: row.rowIndex, personId: undefined, suggestions: [] };

    const normalized = normalizeName(nameRaw);
    const scored = people
      .map((p) => ({ personId: p.id, name: p.displayName, score: nameScore(normalized, normalizeName(p.displayName)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score === 1) return { rowIndex: row.rowIndex, personId: best.personId, suggestions: [] };

    return { rowIndex: row.rowIndex, personId: undefined, suggestions: scored.slice(0, 3) };
  });
}

// ---------------------------------------------------------------------------
// 4. Diff against what's already on file
// ---------------------------------------------------------------------------

export type AbsenceRowDecision = 'add' | 'update' | 'unchanged';

export interface AbsenceImportRow {
  readonly rowIndex: number;
  readonly personId: PersonId;
  readonly type: AbsenceType;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly note: string | undefined;
  readonly decision: AbsenceRowDecision;
  readonly existing: Absence | undefined;
}

export interface GoneAbsence {
  readonly absence: Absence;
  readonly personName: string;
}

export interface AbsenceImportDiff {
  readonly rows: readonly AbsenceImportRow[];
  readonly unresolved: readonly ParsedAbsenceRow[];
  readonly invalid: readonly ParsedAbsenceRow[];
  readonly gone: readonly GoneAbsence[];
}

function existingKey(personId: PersonId, from: IsoDate, to: IsoDate): string {
  return `${personId}|${from}|${to}`;
}

export function diffAbsenceImport(params: {
  readonly rows: readonly ParsedAbsenceRow[];
  readonly matches: readonly PersonMatch[];
  readonly existingAbsences: readonly Absence[];
  readonly index: DatasetIndex;
}): AbsenceImportDiff {
  const { rows, matches, existingAbsences, index } = params;
  const matchByRow = new Map(matches.map((m) => [m.rowIndex, m]));

  const invalid = rows.filter((r) => r.error);
  const resolvable = rows.filter((r) => !r.error);
  const unresolved = resolvable.filter((r) => !matchByRow.get(r.rowIndex)?.personId);

  const existingByKey = new Map<string, Absence>();
  for (const absence of existingAbsences) {
    if (absence.source !== 'IMPORT') continue;
    existingByKey.set(existingKey(absence.personId, absence.from, absence.to), absence);
  }

  const seen = new Set<string>();
  const diffRows: AbsenceImportRow[] = [];

  for (const row of resolvable) {
    const personId = matchByRow.get(row.rowIndex)?.personId;
    if (!personId || !row.from || !row.to) continue;

    const key = existingKey(personId, row.from, row.to);
    seen.add(key);
    const existing = existingByKey.get(key);
    const decision: AbsenceRowDecision = !existing
      ? 'add'
      : existing.type === row.type && (existing.note ?? '') === (row.note ?? '')
        ? 'unchanged'
        : 'update';

    diffRows.push({
      rowIndex: row.rowIndex,
      personId,
      type: row.type,
      from: row.from,
      to: row.to,
      note: row.note,
      decision,
      existing,
    });
  }

  // "Gone" is scoped to the date span this import actually covers — a
  // partial-period export (e.g. only August) must not flag July's already
  // taken leave as cancelled just because it wasn't in this file.
  const covered = coveredRange(resolvable);
  const gone: GoneAbsence[] = covered
    ? existingAbsences
        .filter(
          (a) =>
            a.source === 'IMPORT' &&
            !seen.has(existingKey(a.personId, a.from, a.to)) &&
            rangesOverlap(covered, { from: a.from, to: a.to }),
        )
        .map((absence) => ({
          absence,
          personName: index.people.get(absence.personId)?.displayName ?? absence.personId,
        }))
    : [];

  return { rows: diffRows, unresolved, invalid, gone };
}

function coveredRange(rows: readonly ParsedAbsenceRow[]): DateRange | undefined {
  const froms = rows.map((r) => r.from).filter((d): d is IsoDate => !!d);
  const tos = rows.map((r) => r.to).filter((d): d is IsoDate => !!d);
  if (froms.length === 0 || tos.length === 0) return undefined;
  return { from: froms.reduce((a, b) => (a < b ? a : b)), to: tos.reduce((a, b) => (a > b ? a : b)) };
}

// ---------------------------------------------------------------------------
// 5. Impact on published assignments
// ---------------------------------------------------------------------------

export interface ImportImpactItem {
  readonly assignment: Assignment;
  readonly personName: string;
}

/** New or changed leave that overlaps a *published* shift assignment needs a replacement. */
export function computeImportImpact(params: {
  readonly rows: readonly AbsenceImportRow[];
  readonly publishedAssignments: readonly Assignment[];
  readonly index: DatasetIndex;
}): readonly ImportImpactItem[] {
  const { rows, publishedAssignments, index } = params;
  const affecting = rows.filter((r) => r.decision !== 'unchanged');

  const items: ImportImpactItem[] = [];
  for (const assignment of publishedAssignments) {
    if (assignment.content.kind !== 'SHIFT') continue;
    const hit = affecting.find(
      (r) => r.personId === assignment.personId && assignment.date >= r.from && assignment.date <= r.to,
    );
    if (!hit) continue;
    items.push({ assignment, personName: index.people.get(assignment.personId)?.displayName ?? assignment.personId });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 6. Apply — one batch of draft changes
// ---------------------------------------------------------------------------

let localSeq = 0;
let localId = 0;
function nextAbsenceId(): string {
  localId += 1;
  return `abs-import-${Date.now().toString(36)}-${localId}`;
}

/**
 * Builds the whole import as one flat list of `DraftChange`s. `seq` here is
 * a local placeholder, same convention as `autoPopulate` — the store
 * re-sequences through its own counter when the batch lands in the draft, so
 * a manual edit made between preview and accept can't end up with an
 * earlier `seq` than changes generated before it.
 */
export function buildImportChanges(params: {
  readonly rows: readonly AbsenceImportRow[];
  readonly gone: readonly GoneAbsence[];
  readonly goneToRemove: ReadonlySet<string>;
  readonly batchId: string;
  readonly now: IsoInstant;
}): DraftChange[] {
  const { rows, gone, goneToRemove, batchId, now } = params;
  const changes: DraftChange[] = [];
  const seq = () => {
    localSeq += 1;
    return localSeq;
  };

  for (const row of rows) {
    const after: Absence = {
      id: row.existing?.id ?? nextAbsenceId(),
      personId: row.personId,
      type: row.type,
      from: row.from,
      to: row.to,
      source: 'IMPORT',
      importBatchId: batchId,
      lastSeenInImportAt: now,
      ...(row.note ? { note: row.note } : {}),
      ...(row.existing?.syncedToHrAt !== undefined ? { syncedToHrAt: row.existing.syncedToHrAt } : {}),
    };
    changes.push(absenceChange(row.existing ?? null, after, seq(), now));
  }

  for (const item of gone) {
    if (!goneToRemove.has(item.absence.id)) continue;
    changes.push(absenceChange(item.absence, null, seq(), now));
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** Most recent import timestamp across visible absences, for the header badge. */
export function absenceFreshness(
  absences: readonly Pick<Absence, 'lastSeenInImportAt'>[],
): IsoInstant | undefined {
  let latest: IsoInstant | undefined;
  for (const absence of absences) {
    if (!absence.lastSeenInImportAt) continue;
    if (!latest || absence.lastSeenInImportAt > latest) latest = absence.lastSeenInImportAt;
  }
  return latest;
}
