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
import { type Location, type Person } from '../../domain/types.ts';
import { isAllUnits, scopeIncludes } from '../../domain/unitScope.ts';
import { UnitScopePicker } from './UnitScopePicker.tsx';
import { absenceFreshness } from '../../engine/absenceImport.ts';
import { daysBetween, formatInZone, parseDate } from '../../engine/dates.ts';
import { dedupeLocationsByZone } from '../../engine/locationClocks.ts';
import { hasDraftChanges, useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useNow } from '../../ui/useNow.ts';
import * as Popover from '@radix-ui/react-popover';
import {
  useIdentitySwitcher,
  type AuthIdentity,
} from '../../auth/AuthProvider.tsx';
import { Select, type SelectOption } from '../../ui/primitives.tsx';
import { useRoleAssignments } from '../../api/roleAssignments.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { NotificationBell } from './NotificationBell.tsx';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  /** Hidden from anyone who administers nothing. Settings is configuration, and a tab
   * that 403s on arrival is worse than no tab (ADR-0051). */
  readonly adminOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  // NOTE: Dashboard and timeline are one screen: both answered "are we
  // covered?", and splitting them cost a navigation without buying anything.
  { to: '/overview', label: 'Overview' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/people', label: 'People' },
  // Your own months, read like a calendar. The grid is a planner's instrument, and
  // reaching your own row in it to book November is not what it is for.
  { to: '/me', label: 'My calendar' },
  // NOTE: Requests sits in the main nav, not behind a menu (ADR-0047): it is the only
  // screen most of the ~80 people ever need, and burying self-service is how you end up
  // with a self-service portal nobody uses.
  { to: '/requests', label: 'Requests' },
  { to: '/settings', label: 'Settings', adminOnly: true },
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

  // Resolved server-side and mirrored into the store (ADR-0039), so the badge, the
  // audit trail and what the grid lets you touch cannot disagree.
  const identity = useAuth();

  const units = reference?.units ?? [];
  const people = reference?.people ?? [];

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
    <header className="masthead flex h-14 shrink-0 items-center gap-3 px-4">
      <div className="flex shrink-0 items-center gap-2.5">
        <span aria-hidden className="brand__mark">
          S
        </span>
        <span className="brand__name hidden flex-none whitespace-nowrap lg:block">
          shift<em>·</em>o<em>·</em>mator
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

        <NotificationBell />

        <div className="h-6 w-px bg-line" />

        <div className="flex items-center gap-2.5">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[12.5px] font-semibold">{identity.displayName}</div>
            <div className="text-[11px] text-faint">{describeGrants(identity)}</div>
          </div>
          <span aria-hidden className="avatar">
            {initialsOf(identity.displayName)}
          </span>
          {identity.stubMode ? <IdentitySwitcher people={people} current={identity} /> : null}
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
 * Location clocks — one per location actually in play, and **the display-timezone
 * picker**: click a clock to read every time in that zone.
 *
 * WHY the control is here and not on a screen of its own: it went to Settings, then to a
 * Display menu beside the avatar, and both were the same mistake in different places — a
 * separate control for a choice the clocks already display. The clocks say which zone is
 * active; clicking one is the shortest possible way to say "that one".
 *
 * The earlier objection (owner review: clicking a clock changed two tooltips on Overview
 * and looked broken) was about what the setting *reaches*, not about where it lives. It
 * reaches the day-detail axis, the palette's time labels and Overview's tooltips; each
 * location keeps its own axis on Overview regardless, which is what made the effect look
 * smaller than it is.
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
  const setDisplayZone = useUi((s) => s.setDisplayZone);
  const clocks = dedupeLocationsByZone(locations, primaryLocationIds);

  if (clocks.length === 0) return null;

  return (
    <div
      className="hidden items-center gap-1.5 lg:flex"
      role="radiogroup"
      aria-label="Display timezone"
    >
      <button
        type="button"
        className="pill"
        role="radio"
        aria-checked={displayZone === 'shift'}
        data-active={displayZone === 'shift'}
        onClick={() => setDisplayZone('shift')}
        title="Read every time in the shift's own timezone"
      >
        Shift time
      </button>
      {clocks.map((location) => (
        <button
          key={location.timeZone}
          type="button"
          className="pill"
          role="radio"
          aria-checked={displayZone === location.timeZone}
          data-active={displayZone === location.timeZone}
          onClick={() => setDisplayZone(location.timeZone)}
          title={`Read every time in ${location.name} time (${location.timeZone})`}
        >
          <span className="font-medium">{location.name}</span>{' '}
          <span className="font-mono">{formatInZone(now, location.timeZone)}</span>
        </button>
      ))}
    </div>
  );
}

function Masthead() {
  const caps = useCapabilities();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || caps.administersSomewhere);

  return (
    <nav
      className="masthead masthead--foot flex h-11 shrink-0 items-end gap-1 px-4"
      aria-label="Sections"
    >
      {items.map((item) => (
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

/**
 * Acts as somebody else, for testing roles and self-service.
 *
 * **Person only.** There was a role override here too, and it was the wrong shape: it
 * granted roles *globally*, which is a state the real product cannot produce, so what you
 * were testing was not a configuration anybody could ever be in. Worse, it read as broken
 * — grants live in Settings → Roles, so the honest way to see what a planner of one unit
 * experiences is to grant that and act as them.
 *
 * Acting as a person now shows exactly the grants that person holds. If the answer is
 * wrong, the grant is wrong, and the grant is a row you can fix.
 *
 * Only rendered when the server reports `Auth:Mode=Stub`, which is the only mode that
 * honours the header this sets (`StubAuthenticationHandler`). There is no path to it in
 * a real deployment, and `Docs/00-overview.md`'s "any in-app role switcher is a
 * development convenience and must not ship" is satisfied by that gate rather than by
 * hoping nobody finds it.
 */
function IdentitySwitcher({
  people,
  current,
}: {
  readonly people: readonly Person[];
  readonly current: AuthIdentity;
}) {
  const switchTo = useIdentitySwitcher();

  // WHY the roles are on the labels: acting as somebody is now the only way to see what
  // a role does, and there was nothing anywhere saying who holds one — so finding an
  // administrator meant trying people one at a time.
  const grants = useRoleAssignments();
  const rolesByPerson = new Map<string, string[]>();
  const globalAdmins = new Set<string>();
  for (const grant of grants.data ?? []) {
    const held = rolesByPerson.get(grant.personId) ?? [];
    const scope = grant.unitId ? grant.unitId.replace(/^unit-/, '').toUpperCase() : 'all';
    const role = grant.role.charAt(0).toUpperCase() + grant.role.slice(1);
    held.push(`${role} (${scope})`);
    rolesByPerson.set(grant.personId, held);
    if (!grant.unitId && grant.role.toLowerCase() === 'admin') globalAdmins.add(grant.personId);
  }

  // Grant-holders first, and the global administrators above them. Alphabetical order put
  // the one person who can change global configuration somewhere in the middle of
  // twenty-seven names, with nothing marking them out — so "there is no global
  // administrator" was a reasonable conclusion to draw from this list.
  const rank = (personId: string): number =>
    globalAdmins.has(personId) ? 0 : rolesByPerson.has(personId) ? 1 : 2;

  const peopleOptions: readonly SelectOption[] = [
    { value: '', label: '— server default —' },
    ...[...people]
      .sort((a, b) => rank(a.id) - rank(b.id) || a.displayName.localeCompare(b.displayName))
      .map((person) => {
        const held = rolesByPerson.get(person.id);
        return {
          value: person.id,
          label: held ? `${person.displayName} — ${[...new Set(held)].join(', ')}` : person.displayName,
        };
      }),
  ];


  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="pill pill--warn"
          title="Development only: act as another person or role"
        >
          dev
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[240px] rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <p className="mb-2 px-1 text-[11px] text-faint">
            Stub auth. Switching drops every cached query — you are a different person.
          </p>

          <label className="block text-[12px]">
            <span className="mb-1 block font-medium">Act as</span>
            <Select
              value={current.personId}
              onChange={(personId) => switchTo({ personId })}
              options={peopleOptions}
              ariaLabel="Act as person"
            />
          </label>

          <p className="mt-2 px-1 text-[10.5px] text-faint">
            You get whatever grants that person holds. To change what somebody can do, grant
            it on Settings → Roles.
          </p>
          <p className="mt-1 px-1 text-[10.5px] text-faint">{describeGrants(current)}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The badge under the name. Roles are a set scoped to units, so this summarises rather
 * than naming one: "Planner, Approver" globally, or "Planner (AMER)" when it is narrower.
 */
function describeGrants(identity: AuthIdentity): string {
  const real = identity.grants.filter((grant) => grant.role !== 'Viewer');
  if (real.length === 0) return 'Viewer';

  return [
    ...new Set(
      real.map((grant) => (grant.unitId ? `${grant.role} (${grant.unitId.replace(/^unit-/, '').toUpperCase()})` : grant.role)),
    ),
  ].join(', ');
}
