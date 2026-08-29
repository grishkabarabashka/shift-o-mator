/**
 * WHY: One grid cell, deliberately dumb and memoized: up to two and a half
 * thousand cells on screen, and anything extra in one multiplies by that
 * count. The context menu lives once for the whole grid (`AssignmentPicker`);
 * selection arrives as boolean props, so rows outside the selection don't
 * re-render at all.
 *
 * NOTE: What to show is decided by the projection (`engine/cellValue.ts`), not
 * this component: the "shift > absence > comp day > holiday > marker"
 * priority lives in one place.
 */

import { memo } from 'react';
import type {
  CellStatus,
  CellValue,
  DayPortion,
  IsoDate,
  Issue,
  PersonId,
  Shift,
} from '../../domain/types.ts';

/**
 * NOTE: Labels for the fixed roster states, as the original spreadsheet wrote them.
 * `ABSENT` is a fallback: an absence normally renders its event type's own short label
 * (ADR-0049).
 */
export const STATUS_LABEL: Record<CellStatus, string> = {
  PH: 'PH',
  COMP_OFF: 'C-Off',
  ABSENT: 'Absent',
};

const PORTION_SUFFIX: Record<DayPortion, string> = {
  FULL: '',
  MORNING: ' AM',
  AFTERNOON: ' PM',
};

interface Props {
  readonly personId: PersonId;
  readonly personName: string;
  readonly date: IsoDate;
  readonly value: CellValue;
  readonly shift: Shift | undefined;
  readonly issues: readonly Issue[];
  readonly nonWorking: boolean;
  readonly today: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly generationLocked: boolean;
  /** NOTE: 1-based grid column, for `aria-colindex`. Column 1 is the person name. */
  readonly colIndex: number;
  /**
   * NOTE: Presence, already reduced to a delta from the person's baseline (ADR-0043) —
   * `undefined` for the overwhelming majority of cells.
   *
   * WHY two strings and not a `PresenceMark` object: `GridCell` is memoized on
   * primitives across ~2500 instances, and an object prop would be a new reference on
   * every render of every cell.
   */
  readonly presenceGlyph?: string | undefined;
  readonly presenceLabel?: string | undefined;
  readonly presencePortion?: DayPortion | undefined;
  readonly presenceColor?: string | undefined;
  /** NOTE: A comp day the system suggested for this day, not yet asked for or agreed.
   * A boolean, not the id: the cell is memoized on primitives (CLAUDE.md). */
  readonly proposedCompDay?: boolean | undefined;
  /** NOTE: Where the person normally is — drawn quieter than an away day. */
  readonly presenceAtBaseline?: boolean | undefined;
  /** NOTE: A request covering this cell that nobody has decided yet (ADR-0045). Drawn
   * dashed — it is a proposal, and must never read as a fact. */
  readonly pendingGlyph?: string | undefined;
  readonly pendingLabel?: string | undefined;
  readonly pendingPortion?: DayPortion | undefined;
  readonly isSelf?: boolean | undefined;
  /** NOTE: Name of another planner holding an unpublished edit on this cell (ADR-0015).
   * A string and not an object, for the same reason presence is two strings: ~2500 cells,
   * memoized on primitives. */
  readonly stagedBy?: string | undefined;
  /** NOTE: Alternate-row tint. A boolean because the cell is memoized on primitives. */
  readonly banded?: boolean | undefined;
  /** NOTE: The columns are wide enough for the shift's hours as well as its code — true
   * on the week zoom, where a cell is ~150px and the code alone leaves it looking empty. */
  readonly roomy?: boolean | undefined;
}

function GridCellInner({
  personId,
  personName,
  date,
  value,
  shift,
  issues,
  nonWorking,
  today,
  selected,
  focused,
  generationLocked,
  colIndex,
  presenceGlyph,
  presenceLabel,
  presencePortion,
  presenceColor,
  proposedCompDay,
  presenceAtBaseline,
  pendingGlyph,
  pendingLabel,
  pendingPortion,
  isSelf,
  stagedBy,
  banded,
  roomy,
}: Props) {
  const status = value.kind === 'STATUS' ? value.status : undefined;
  const event = value.kind === 'STATUS' || value.kind === 'SHIFT' ? value.event : undefined;
  const conflict = value.kind === 'SHIFT' ? value.conflict : undefined;

  // An absence shows its own type's short label; a holiday or comp day uses its own.
  const statusText = status
    ? `${event?.shortLabel ?? STATUS_LABEL[status]}${PORTION_SUFFIX[event?.portion ?? 'FULL']}`
    : undefined;

  /*
   * WHERE the absence is drawn.
   *
   * As a **fill behind the whole cell**, always. Being on leave is a statement about the
   * day, not a detail hanging off the bottom of it, and the eye has to be able to sweep a
   * month and see who is out — a 9px band under a chip does not do that (ADR-0052).
   *
   * A half-day fills its own half, on the side it falls, so "out this morning" is
   * distinguishable from "out all day" without reading anything.
   *
   * A shift on the same day keeps its chip, drawn **over** the fill and flagged as a
   * conflict. Forbidding the combination outright is tempting and wrong: somebody off in
   * the morning who works the afternoon is a real roster, and refusing it would push that
   * case out of the tool.
   */
  const fillEvent = event;

  const worstLevel = issues.some((issue) => issue.level === 'BLOCKING')
    ? 'BLOCKING'
    : issues.some((issue) => issue.level === 'WARNING')
      ? 'WARNING'
      : undefined;

  // A confirmed comp day closes the day out; an absence does so only if its type says
  // it blocks (ADR-0049). Holiday and Off never do.
  const locked = status === 'COMP_OFF' || (status === 'ABSENT' && (event?.blocksAssignment ?? true));

  // Built once and used for both `title` and `aria-label`: `title` needs line breaks to
  // be readable, `aria-label` must not have them, and the facts must not drift apart.
  const description = describeCell(
    personName,
    date,
    shift,
    statusText ?? (event ? `${event.shortLabel}${PORTION_SUFFIX[event.portion]}` : undefined),
    conflict,
    issues,
    generationLocked,
    presenceLabel,
    pendingLabel,
    stagedBy,
  );

  return (
    <div
      className="cell"
      role="gridcell"
      // WHY an id: the grid keeps DOM focus on its scroll container and moves a virtual
      // cursor, so `aria-activedescendant` on the container is the only way a screen
      // reader learns which cell is current. That needs a stable, unique id per cell.
      id={cellDomId(personId, date)}
      aria-colindex={colIndex}
      aria-selected={selected}
      // NOTE: Colour and hatching carry meaning here (conflict, absence, issue level).
      // The tooltip repeats all of it in words, but `title` is not reachable without a
      // pointer — `aria-label` is what a keyboard or screen-reader user actually gets.
      aria-label={description.join('. ')}
      data-cell
      data-person={personId}
      data-date={date}
      title={description.join(`
`)}
      data-nonworking={nonWorking || undefined}
      data-today={today || undefined}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      data-issue={worstLevel}
      data-self={isSelf || undefined}
      data-conflict={conflict !== undefined || undefined}
      data-staged={stagedBy !== undefined || undefined}
      data-band={banded || undefined}
    >
      {/* Behind everything, and inert: the fill is the day's state, the content on top of
          it is what is planned for the day. */}
      {fillEvent ? (
        <span
          className="cell__fill"
          data-portion={fillEvent.portion !== 'FULL' ? fillEvent.portion : undefined}
          // 30% shouted over the chips it sits behind. The fill has to be readable as a
          // ground, not compete with the shift code printed on top of it — the colour is
          // the event type's own and is editable in Settings, so this stays a wash.
          style={{ background: `color-mix(in srgb, ${fillEvent.color} 18%, transparent)` }}
          aria-hidden
        />
      ) : null}

      {/* backgroundColor and not background on the chip below: the shorthand resets
          background-image, and `.chip` paints its gradient and ring over the shift's own
          colour. */}
      <span className="cell__main">
      {value.kind === 'SHIFT' && shift ? (
        <span className="chip" style={{ backgroundColor: shift.color }}>
          {generationLocked ? <span className="chip__lock" aria-hidden /> : null}
          {shift.code}
          {roomy ? (
            <span className="chip__time">
              {shift.start}–{shift.end}
            </span>
          ) : null}
        </span>
      ) : statusText ? (
        <span className="cell__status" style={event ? { color: event.color } : undefined}>
          {statusText}
        </span>
      ) : null}
      </span>

      {/* WHY a band and not a corner mark: presence and a pending request are facts that
          coexist with whatever the cell already says — a person can be on `Crew` *and*
          remote *and* have leave awaiting approval. The chip owns the top of the cell;
          this owns the bottom, split in half when only part of the day is covered. */}
      {presenceGlyph || pendingGlyph || proposedCompDay ? (
        <span className="cell__band" aria-hidden>
          {/* A proposed comp day is a dashed hint — the day is still free, and nobody has
              agreed to it. It used to be drawn only on an *empty* cell, so on a rota where
              every cell holds a shift — which is most of them — the proposals the planner
              is meant to act on were invisible. The band is where facts that coexist with
              the chip live. */}
          {proposedCompDay ? (
            <span className="cell__band-part cell__band-part--pending">C-Off?</span>
          ) : null}
          {pendingGlyph ? (
            <span
              className="cell__band-part cell__band-part--pending"
              data-portion={pendingPortion !== 'FULL' ? pendingPortion : undefined}
            >
              {pendingGlyph}
            </span>
          ) : null}
          {presenceGlyph && !locked ? (
            <span
              className="cell__band-part"
              data-portion={presencePortion !== 'FULL' ? presencePortion : undefined}
              data-quiet={presenceAtBaseline || undefined}
              style={
                presenceColor
                  ? {
                      color: presenceColor,
                      // The band is 9px and carries a letter, so it needs more saturation
                      // than the absence wash behind the whole cell — it is read at a
                      // glance, not looked through (ADR-0043).
                      background: `color-mix(in srgb, ${presenceColor} 24%, transparent)`,
                    }
                  : undefined
              }
            >
              {presenceGlyph}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** NOTE: Stable DOM id for one cell — see `aria-activedescendant` above. Dates are
 * ISO and person ids are slugs, so this needs no escaping. */
export function cellDomId(personId: PersonId, date: IsoDate): string {
  return `cell-${personId}-${date}`;
}

/**
 * NOTE: Everything worth knowing about this cell, as a list of lines.
 *
 * Two renderings need the same facts in different shapes: `title` wants line breaks to
 * stay readable, `aria-label` must not contain them (a screen reader would run the
 * whole thing together). Building the parts once keeps the two from drifting.
 */
function describeCell(
  personName: string,
  date: IsoDate,
  shift: Shift | undefined,
  statusText: string | undefined,
  conflict: string | undefined,
  issues: readonly Issue[],
  generationLocked: boolean,
  presenceLabel: string | undefined,
  pendingLabel: string | undefined,
  stagedBy: string | undefined,
): string[] {
  const parts: string[] = [`${personName} · ${date}`];
  if (shift) {
    parts.push(`${shift.code} ${shift.start}–${shift.end} (${shortZone(shift.timeZone)})`);
    if (shift.description) parts.push(shift.description);
  }
  if (statusText) parts.push(statusText);
  if (conflict) parts.push(`Conflict: assigned over ${conflict.toLowerCase()}`);
  for (const issue of issues) parts.push(issue.message);
  if (generationLocked) parts.push("Locked — auto-populate will not replace this");
  // Presence is drawn as a glyph, which is colour-and-shape only; the words go here so
  // the information is not pointer-only (Docs/04, rule 14).
  if (presenceLabel) parts.push(presenceLabel);
  if (pendingLabel) parts.push(pendingLabel);
  if (stagedBy) parts.push(`${stagedBy} has an unpublished edit on this cell`);
  return parts;
}

function shortZone(zone: string): string {
  return zone.split('/').at(-1)?.replace(/_/g, ' ') ?? zone;
}

export const GridCell = memo(GridCellInner);
