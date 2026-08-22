/**
 * Оболочка приложения: шапка продукта, навигация и контекстные переключатели.
 *
 * Общая шапка с названием, переключателями и бейджем пользователя, под ней —
 * горизонтальные вкладки. Ровно один экран активен, контекст (единица,
 * таймзона отображения) живёт в шапке и переживает переход между вкладками:
 * планировщик не выбирает единицу заново, прыгая с Overview в расписание.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ALL_UNITS, type Location } from '../../domain/types.ts';
import { absenceFreshness } from '../../engine/absenceImport.ts';
import { daysBetween, formatInZone, parseDate } from '../../engine/dates.ts';
import { hasDraftChanges, useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useNow } from '../../ui/useNow.ts';
import { Select } from '../../ui/primitives.tsx';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  // Дашборд и таймлайн — один экран: оба отвечали на вопрос «закрыты ли мы»,
  // разделение стоило перехода и не давало ничего.
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
  const setDisplayZone = useUi((s) => s.setDisplayZone);

  // Stub identity for now (Phase 4 client seam) — see `auth/AuthProvider.tsx`. Not the
  // same thing as `useSchedule`'s `currentUserId` (still "first manager in scope",
  // Phase 5's problem to replace); this is who the badge says is signed in.
  const identity = useAuth();

  const units = reference?.units ?? [];

  // Locations of the currently selected unit — `ALL_UNITS` has no locations
  // of its own, so it falls back to every location in the dataset rather
  // than showing an empty strip.
  const unit = reference?.units.find((u) => u.id === unitId);
  const strip: readonly Location[] =
    unitId !== ALL_UNITS && unit
      ? unit.locationIds
          .map((id) => reference?.locations.find((l) => l.id === id))
          .filter((l): l is Location => l !== undefined)
      : (reference?.locations ?? []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-ink"
        >
          S
        </span>
        <span className="hidden flex-none text-[15px] font-semibold tracking-tight whitespace-nowrap lg:block">
          shift-o-mator
        </span>
      </div>

      <div className="ml-3 flex shrink-0 items-center gap-2">
        {/* Единица — фильтр, а не граница (ADR-0020), поэтому «все» стоит
            первым и является значением по умолчанию. */}
        <Select
          ariaLabel="Planning unit"
          value={unitId}
          onChange={setUnit}
          options={[
            { value: ALL_UNITS, label: 'All planning units' },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <AbsenceFreshness absences={publishedAbsences} />

        {editing ? (
          <span className={`pill ${dirty ? 'pill--warn' : 'pill--accent'}`}>
            Draft{dirty ? ` · ${changeCount}` : ''}
          </span>
        ) : null}

        <LocationClockStrip locations={strip} onPick={setDisplayZone} />

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
 * Location clock strip — replaces the timezone dropdown (CLAUDE.md: showing
 * a single named timezone made less sense than several small clocks for the
 * locations actually in play, one per location of the selected unit). Each
 * clock doubles as the display-timezone picker: clicking one sets
 * `displayZone` to that location's zone, so choosing "look at it from
 * Pune's clock" and reading Pune's clock are the same click.
 */
function LocationClockStrip({
  locations,
  onPick,
}: {
  readonly locations: readonly Location[];
  readonly onPick: (zone: string) => void;
}) {
  const now = useNow();
  const displayZone = useUi((s) => s.displayZone);

  // De-duplicated by timezone, not by location — Pune/Kolkata etc. would
  // otherwise repeat the same clock face under different names.
  const byZone = new Map<string, Location>();
  for (const location of locations) {
    if (!byZone.has(location.timeZone)) byZone.set(location.timeZone, location);
  }
  const clocks = [...byZone.values()].sort((a, b) => a.timeZone.localeCompare(b.timeZone));

  if (clocks.length === 0) return null;

  return (
    <div className="hidden items-center gap-1.5 lg:flex" role="group" aria-label="Location times">
      <button
        type="button"
        className="pill"
        data-active={displayZone === 'shift'}
        title="Show each assignment in its own shift's timezone"
        onClick={() => onPick('shift')}
      >
        Shift time
      </button>
      {clocks.map((location) => (
        <button
          key={location.timeZone}
          type="button"
          className="pill"
          data-active={displayZone === location.timeZone}
          title={`${location.name} — ${location.timeZone}`}
          onClick={() => onPick(location.timeZone)}
        >
          <span className="font-medium">{location.name}</span>{' '}
          <span className="font-mono">{formatInZone(now, location.timeZone)}</span>
        </button>
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
