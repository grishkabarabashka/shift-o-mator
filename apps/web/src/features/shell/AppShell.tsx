/**
 * NOTE: App shell: product header, navigation, and contextual switches.
 *
 * A shared header with the name, switches, and a user badge, with horizontal
 * tabs below it. Exactly one screen is active; the context (unit, display
 * timezone) lives in the header and survives switching tabs: the planner
 * doesn't re-pick the unit when jumping from Overview to the schedule.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { type Location } from '../../domain/types.ts';
import { isAllUnits, scopeIncludes } from '../../domain/unitScope.ts';
import { UnitScopePicker } from './UnitScopePicker.tsx';
import { absenceFreshness } from '../../engine/absenceImport.ts';
import { daysBetween, formatInZone, parseDate } from '../../engine/dates.ts';
import { dedupeLocationsByZone } from '../../engine/locationClocks.ts';
import { hasDraftChanges, useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useNow } from '../../ui/useNow.ts';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  // NOTE: Dashboard and timeline are one screen: both answered "are we
  // covered?", and splitting them cost a navigation without buying anything.
  { to: '/overview', label: 'Overview' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/people', label: 'People' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProductHeader />
      <Masthead />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function ProductHeader() {
  const reference = useSchedule((s) => s.reference);
  const editing = useSchedule((s) => s.session !== undefined);
  const dirty = useSchedule(hasDraftChanges);
  const changeCount = useSchedule((s) => s.changes.length);
  // Published, not draft: this is what every viewer is trusting right now,
  // so it should not look freshly imported until the import is published.
  const publishedAbsences = useSchedule((s) => s.published?.absences);

  const unitId = useUi((s) => s.unitId);
  const setUnit = useUi((s) => s.setUnit);

  // Stub identity for now (Phase 4 client seam) — see `auth/AuthProvider.tsx`. Not the
  // same thing as `useSchedule`'s `currentUserId` (still "first manager in scope",
  // Phase 5's problem to replace); this is who the badge says is signed in.
  const identity = useAuth();

  const units = reference?.units ?? [];

  // Locations of the units in scope. "All" has no locations of its own, and
  // neither does a scope naming several units — both fall back to every
  // location in the dataset rather than showing an empty strip.
  const scopedUnits = units.filter((u) => scopeIncludes(unitId, u.id));
  const strip: readonly Location[] =
    !isAllUnits(unitId) && scopedUnits.length > 0
      ? [...new Set(scopedUnits.flatMap((u) => u.locationIds))]
          .map((id) => reference?.locations.find((l) => l.id === id))
          .filter((l): l is Location => l !== undefined)
      : (reference?.locations ?? []);

  // Any unit's primary location is the "real" name for its timezone — Hartford
  // and New York share America/New_York, and which one a plain list happens to
  // list first is an accident of id sort order, not a fact about which city
  // people actually mean by that clock.
  const primaryLocationIds = new Set(units.map((u) => u.primaryLocationId));

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 shadow-[0_1px_3px_rgb(16_24_40_/_0.05)]">
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-accent-ink"
          style={{ background: 'linear-gradient(155deg, var(--accent), color-mix(in srgb, var(--accent) 70%, black))' }}
        >
          S
        </span>
        <span className="hidden flex-none text-[15px] font-semibold tracking-tight whitespace-nowrap lg:block">
          shift-o-mator
        </span>
      </div>

      <div className="h-6 w-px shrink-0 bg-line" />

      <div className="flex shrink-0 items-center gap-2">
        {/* NOTE: A unit is a filter, not a boundary (ADR-0020): any combination
            can be selected, "all" is the default. */}
        <UnitScopePicker units={units} scope={unitId} onChange={setUnit} />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <AbsenceFreshness absences={publishedAbsences} />

        {editing ? (
          <span className={`pill ${dirty ? 'pill--warn' : 'pill--accent'}`}>
            Draft{dirty ? ` · ${changeCount}` : ''}
          </span>
        ) : null}

        <LocationClockStrip locations={strip} primaryLocationIds={primaryLocationIds} />

        <div className="h-6 w-px bg-line" />

        <div className="flex items-center gap-2.5">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[12.5px] font-semibold">{identity.displayName}</div>
            <div className="text-[11px] text-faint">{identity.role}</div>
          </div>
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent"
          >
            {initialsOf(identity.displayName)}
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * "Absences current as of 12 Aug (3 days ago)" (Docs/11) — without this,
 * nobody knows in six months whether the leave data on screen is trustworthy.
 * Hidden until the first import ever lands; a never-imported dataset isn't
 * stale, it's just not wired to the leave system yet.
 */
function AbsenceFreshness({ absences }: { readonly absences: readonly { lastSeenInImportAt?: string }[] | undefined }) {
  const at = absences ? absenceFreshness(absences) : undefined;
  if (!at) return null;

  const date = at.slice(0, 10);
  const daysAgo = daysBetween(date, TODAY);
  const relative = daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

  return (
    <span
      className="hidden text-[11px] text-faint lg:inline"
      title="Most recent absence-import batch across published records"
    >
      Absences current as of {parseDate(date).toFormat('d LLL')} ({relative})
    </span>
  );
}

/**
 * Location clock strip — a read-only indicator, one small clock per location
 * actually in play. Used to double as the display-timezone picker; that
 * picker moved to Settings → Display (owner review: clicking a clock in the
 * header changed two tooltip strings on Overview and nothing else, which
 * read as broken rather than as a working control — ADR-0036). The active
 * pill still shows which zone is currently selected there.
 */
function LocationClockStrip({
  locations,
  primaryLocationIds,
}: {
  readonly locations: readonly Location[];
  readonly primaryLocationIds: ReadonlySet<string>;
}) {
  const now = useNow();
  const displayZone = useUi((s) => s.displayZone);
  const clocks = dedupeLocationsByZone(locations, primaryLocationIds);

  if (clocks.length === 0) return null;

  return (
    <div className="hidden items-center gap-1.5 lg:flex" role="group" aria-label="Location times">
      <span
        className="pill"
        data-active={displayZone === 'shift'}
        title="Display timezone is 'Shift time' — change it in Settings → Display"
      >
        Shift time
      </span>
      {clocks.map((location) => (
        <span
          key={location.timeZone}
          className="pill"
          data-active={displayZone === location.timeZone}
          title={`${location.name} — ${location.timeZone}. Change the display timezone in Settings → Display.`}
        >
          <span className="font-medium">{location.name}</span>{' '}
          <span className="font-mono">{formatInZone(now, location.timeZone)}</span>
        </span>
      ))}
    </div>
  );
}

function Masthead() {
  return (
    <nav
      className="flex h-11 shrink-0 items-end gap-1 border-b border-line bg-surface px-4"
      aria-label="Sections"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className="tab">
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function initialsOf(name: string | undefined): string {
  if (!name) return '—';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
