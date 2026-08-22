/**
 * Оболочка приложения: шапка продукта, навигация и контекстные переключатели.
 *
 * Раскладка по спеке §3.2: общая шапка с названием, переключателями и бейджем
 * пользователя, под ней — горизонтальные вкладки. Ровно один экран активен,
 * контекст (единица, «весь регион», таймзона отображения) живёт в шапке и
 * переживает переход между вкладками: планировщик не выбирает регион заново,
 * прыгая с дашборда в расписание.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { hasDraftChanges, useSchedule } from '../../store/useSchedule.ts';
import { useUi, type DisplayZone } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';

export interface NavItem {
  readonly to: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/timeline', label: 'Timeline' },
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
  const currentUserId = useSchedule((s) => s.currentUserId);
  const editing = useSchedule((s) => s.session !== undefined);
  const dirty = useSchedule(hasDraftChanges);
  const changeCount = useSchedule((s) => s.changes.length);

  const unitId = useUi((s) => s.unitId);
  const setUnit = useUi((s) => s.setUnit);
  const wholeRegion = useUi((s) => s.wholeRegion);
  const setWholeRegion = useUi((s) => s.setWholeRegion);
  const displayZone = useUi((s) => s.displayZone);
  const setDisplayZone = useUi((s) => s.setDisplayZone);

  const units = reference?.units ?? [];
  const me = reference?.people.find((person) => person.id === currentUserId);

  const zoneOptions: SelectOption[] = [
    { value: 'role', label: 'Role time' },
    { value: 'UTC', label: 'UTC' },
    ...[...new Set((reference?.locations ?? []).map((location) => location.timeZone))]
      .sort()
      .map((zone) => ({ value: zone, label: zone })),
  ];

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
        <Select
          ariaLabel="Planning unit"
          value={unitId}
          onChange={setUnit}
          options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
        />
        {/* Единица — фильтр по умолчанию, а не граница (ADR-0020). */}
        <button
          type="button"
          className="btn btn--sm"
          data-active={wholeRegion}
          onClick={() => setWholeRegion(!wholeRegion)}
          title="A planning unit is a default filter, not a boundary — show everyone in the region"
        >
          Whole region
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {editing ? (
          <span className={`pill ${dirty ? 'pill--warn' : 'pill--accent'}`}>
            Draft{dirty ? ` · ${changeCount}` : ''}
          </span>
        ) : null}

        <div className="hidden items-center gap-1.5 lg:flex">
          <span className="text-[11.5px] font-medium text-faint">Show in</span>
          <Select
            ariaLabel="Display timezone"
            value={displayZone}
            onChange={(value) => setDisplayZone(value as DisplayZone)}
            options={zoneOptions}
          />
        </div>

        <div className="h-6 w-px bg-line" />

        <div className="flex items-center gap-2.5">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[12.5px] font-semibold">{me?.displayName ?? 'Signed out'}</div>
            <div className="text-[11px] text-faint">{roleLabel(me?.orgCategory)}</div>
          </div>
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent"
          >
            {initialsOf(me?.displayName)}
          </span>
        </div>
      </div>
    </header>
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

function roleLabel(category: string | undefined): string {
  switch (category) {
    case 'MANAGEMENT':
      return 'Planner';
    case 'SERVICE_TRANSITION':
      return 'Service Transition';
    case 'SUPPORT':
      return 'Support';
    default:
      return '—';
  }
}
