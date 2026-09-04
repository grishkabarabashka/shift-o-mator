/**
 * NOTE: App shell: product header, navigation, and contextual switches.
 *
 * A shared header with the name, switches, and a user badge, with horizontal
 * tabs below it. Exactly one screen is active; the context (unit, display
 * timezone) lives in the header and survives switching tabs: the planner
 * doesn't re-pick the unit when jumping from Overview to the schedule.
 */

import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { type Location, type Person } from '../../domain/types.ts';
import { isAllUnits, scopeIncludes } from '../../domain/unitScope.ts';
import { UnitScopePicker } from './UnitScopePicker.tsx';
import { absenceFreshness } from '../../engine/absenceImport.ts';
import { daysBetween, formatInZone, parseDate } from '../../engine/dates.ts';
import { dedupeLocationsByZone } from '../../engine/locationClocks.ts';
import { skyPhase, type SkyPhase } from '../../engine/timeline.ts';
import { useMediaQuery, BREAKPOINT } from '../../ui/useMediaQuery.ts';
import { hasDraftChanges, useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { useNow } from '../../ui/useNow.ts';
import * as Popover from '@radix-ui/react-popover';
import {
  useIdentitySwitcher,
  type AuthIdentity,
} from '../../auth/AuthProvider.tsx';
import { isEntraMode } from '../../auth/entraConfig.ts';
import { signOut } from '../../auth/msalInstance.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';
import { useRoleAssignments } from '../../api/roleAssignments.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { NotificationBell } from './NotificationBell.tsx';
import { BrandMark } from '../../ui/BrandMark.tsx';
import { SkyIcon } from './SkyIcon.tsx';
import { ToastViewport } from '../../ui/ToastViewport.tsx';

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
  // Focus mode (ADR-0057). While a draft is open the chrome carries an accent rail, the
  // canvas takes a hint of accent, and the `.workbench` surface is lifted a rung — see the
  // rules in `theme.css`. Nothing moves, collapses or becomes unreachable: a planner
  // mid-edit is the last person who should hunt for a control that quietly went away.
  //
  // WHY it is `session !== undefined` and not `hasDraftChanges`: the draft opens on the
  // first edit and stays open until it is published or discarded, so this is on for exactly
  // as long as there is unpublished work — including after an undo takes the count back to
  // zero, which is still a draft somebody else can see staged.
  const editing = useSchedule((s) => s.session !== undefined);

  return (
    <div className="shell flex h-full min-h-0 flex-col" data-editing={editing}>
      <SkipLink />
      <ProductHeader />
      <Masthead />
      {/* A real landmark, and the target of the skip link: the shell was header + nav + a
          plain div, so "skip to content" had nowhere to land and a screen reader had no
          main region to jump to. */}
      <main id="content" className="min-h-0 flex-1 overflow-auto">
        {children}
      </main>
      <ToastViewport />
    </div>
  );
}

/**
 * The first thing Tab reaches, and invisible until it is reached.
 *
 * Without it, every keyboard user pays for the header — brand, unit picker, four clocks,
 * the bell, the identity block — on every single navigation before arriving at the work.
 */
function SkipLink() {
  return (
    <a href="#content" className="skip-link">
      Skip to content
    </a>
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
    /* One row, everything optically centred on it. The controls used to be 22px pills,
       26px clocks, 32px fields and a 32px avatar all on `items-center` with a 12px gap,
       which is why the row read as ragged rather than as a bar. Heights are now uniform
       (`--control-h`), the clock widget is the one deliberate exception because it carries
       two lines, and the groups are separated by rules rather than by guessed spacing. */
    <header className="masthead flex h-14 shrink-0 items-center gap-3 px-4">
      <Brand />

      <span aria-hidden className="masthead__rule" />

      {/* NOTE: A unit is a filter, not a boundary (ADR-0020): any combination
          can be selected, "all" is the default. */}
      <UnitScopePicker units={units} scope={unitId} onChange={setUnit} />

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <AbsenceFreshness absences={publishedAbsences} />

        {editing ? (
          <span className={`pill ${dirty ? 'pill--warn' : 'pill--accent'}`}>
            Draft{dirty ? ` · ${changeCount}` : ''}
          </span>
        ) : null}

        <LocationClockStrip locations={strip} primaryLocationIds={primaryLocationIds} />

        <span aria-hidden className="masthead__rule" />

        <NotificationBell />

        <div className="flex items-center gap-2.5">
          <IdentityMenu identity={identity} units={units} />
          {identity.stubMode ? <IdentitySwitcher people={people} current={identity} /> : null}
          {isEntraMode ? <SignOutButton /> : null}
        </div>
      </div>
    </header>
  );
}

/**
 * The name, the badge, and — on click — what the badge is summarising.
 *
 * The summary line alone could not answer the question people actually have, which is
 * "why can I not do this?". It elides duplicates, it is one line wide, and below `sm` it
 * is hidden outright, so on a narrow screen there was nowhere at all to find out what you
 * hold. The menu lists every grant with its scope spelled out, and says the thing that
 * ADR-0051 makes true and nothing in the UI said: roles are a set, and no role implies
 * another — an Admin who cannot plan is correctly configured, not broken.
 */
function IdentityMenu({
  identity,
  units,
}: {
  readonly identity: AuthIdentity;
  readonly units: readonly { readonly id: string; readonly name: string }[];
}) {
  const unitName = (unitId: string): string =>
    units.find((u) => u.id === unitId)?.name ?? unitId;

  // Viewer is granted to everyone signed in, so listing it beside the real grants would
  // pad every menu with a row that distinguishes nobody. It is the baseline line instead.
  const held = identity.grants.filter((grant) => grant.role !== 'Viewer');

  // Global first — it is the widest thing somebody holds and the answer to "who can
  // change configuration" — then by unit, then by role. Role order is alphabetical on
  // purpose: any other order would suggest a ranking, and there is not one.
  const sorted = [...held].sort(
    (a, b) =>
      Number(a.unitId !== null && a.unitId !== undefined) -
        Number(b.unitId !== null && b.unitId !== undefined) ||
      unitName(a.unitId ?? '').localeCompare(unitName(b.unitId ?? '')) ||
      a.role.localeCompare(b.role),
  );

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 hover:bg-hover"
          aria-label={`Signed in as ${identity.displayName}. Show roles.`}
        >
          {/* The name only. The role summary that used to sit under it said something
              different from the menu below — elided, one line wide, and hidden outright
              below `sm` — so the header now asks the question and the menu answers it,
              rather than both half-answering it in different words. */}
          <span className="hidden min-w-0 truncate text-sm font-semibold sm:block">
            {identity.displayName}
          </span>
          <span aria-hidden className="avatar">
            {initialsOf(identity.displayName)}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[260px] rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <p className="px-1 text-sm font-semibold">{identity.displayName}</p>
          <p className="px-1 text-[10.5px] text-faint">
            {identity.resolved ? 'Signed in' : 'Still resolving who you are…'}
          </p>

          <p className="mt-2 mb-1 px-1 text-[10.5px] tracking-wide text-faint uppercase">Roles</p>
          {sorted.length === 0 ? (
            <p className="px-1 text-[12px]">
              Viewer — you can read the rota and record your own time, and nothing else.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sorted.map((grant) => (
                <li
                  key={`${grant.role}:${grant.unitId ?? 'all'}`}
                  className="flex items-baseline justify-between gap-2 px-1 text-[12px]"
                >
                  <span className="font-medium">{grant.role}</span>
                  <span className="truncate text-[11px] text-faint">
                    {grant.unitId ? unitName(grant.unitId) : 'every unit'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 px-1 text-[10.5px] text-faint">
            Roles are a set, and none implies another: an Admin does not plan and a Planner
            does not approve. Grants are edited on Settings → Roles and take effect on the
            next request.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Ends the Entra session. Only rendered when the build signs people in at all —
 * in stub mode there is no session to end.
 */
function SignOutButton() {
  return (
    <button
      type="button"
      className="btn btn--sm"
      title="Sign out"
      onClick={() => void signOut()}
    >
      Sign out
    </button>
  );
}

/**
 * The mark and the wordmark, and a way home.
 *
 * It was not a link. Every other product on the intranet goes to the front page when you
 * click its name, and this one did nothing at all — which is a small thing that quietly
 * tells somebody the software is unfinished.
 *
 * The wordmark keeps its interpuncts in accent, because that is the one piece of the old
 * treatment that was doing work: it breaks `shiftomator` into three readable parts without
 * a hyphen, and it ties the name to the mark beside it.
 */
function Brand() {
  return (
    <Link to="/overview" className="brand" aria-label="shift-o-mator — go to Overview">
      <BrandMark />
      <span className="brand__name">
        SHIFT-O-MATOR
      </span>
    </Link>
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
 * Each clock carries its own sky (ADR-0057): night is deep and cold, dawn and dusk are
 * warm, daytime is light. WHY: the question these exist to answer is "who is awake right
 * now", and as four identical grey pills that question was answered by reading four
 * numbers and subtracting. The phase comes from `skyPhase`, which shares its definition of
 * night with the bands Overview draws behind its axis — the clock and the axis disagreeing
 * about whether it is dark in London is a bug nobody would report and everybody would feel.
 *
 * The sky is never the only carrier: the phase is named in the title, and selection is a
 * ring rather than a wash, so the chosen zone still shows its own weather.
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
/**
 * One clock.
 *
 * Three parts on one baseline-free grid: the phase glyph, the place, the time. The first
 * version put the name and the time side by side on `align-items: baseline` at two
 * different sizes inside a fixed 26px box — so the pair sat on a shared baseline that was
 * itself off-centre in the box, which is precisely why the row looked crooked. Stacking
 * them removes the shared baseline entirely, and the grid centres the whole block.
 */
function Clock({
  location,
  now,
  active,
  onSelect,
}: {
  readonly location: Location;
  readonly now: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const phase = skyPhase(now, location.timeZone);

  return (
    <button
      type="button"
      className="clock"
      role="radio"
      aria-checked={active}
      data-active={active}
      data-phase={phase}
      onClick={onSelect}
      // WHY the phase is written out as well as drawn: colour and a glyph are both
      // shorthand, and neither is a fact somebody can quote back or a screen reader can
      // read. The sky is the fast path, not the only one.
      title={`${PHASE_LABEL[phase]} in ${location.name} — click to read every time on screen in ${location.name} time (${location.timeZone})`}
    >
      <SkyIcon phase={phase} />
      <span className="clock__text">
        <span className="clock__name">{location.name}</span>
        <span className="clock__time">{formatInZone(now, location.timeZone)}</span>
      </span>
    </button>
  );
}

const PHASE_LABEL: Record<SkyPhase, string> = {
  night: 'Night',
  dawn: 'Dawn',
  day: 'Daytime',
  dusk: 'Dusk',
};

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
  const roomForAll = useMediaQuery(BREAKPOINT.xl);

  if (clocks.length === 0) return null;

  // Narrow: the strip becomes the selected clock with the rest behind it. This used to be
  // `hidden lg:flex` — the control that governs how time reads on every screen simply
  // vanished below 1024px, which is not a responsive design but the lack of one.
  if (!roomForAll) {
    return (
      <CollapsedClocks
        clocks={clocks}
        now={now}
        displayZone={displayZone}
        setDisplayZone={setDisplayZone}
      />
    );
  }

  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Display timezone">
      {/* The neutral option, built from the same two lines as a real clock so the row is one
          set of widgets rather than a text button standing next to five of them. It has no
          sky and no glyph on purpose — it is not a place, and giving it weather would claim
          something untrue. */}
      <button
        type="button"
        className="clock clock--abstract"
        role="radio"
        aria-checked={displayZone === 'shift'}
        data-active={displayZone === 'shift'}
        onClick={() => setDisplayZone('shift')}
        title="Read every time in the shift's own timezone, wherever it is worked"
      >
        <span className="clock__text">
          <span className="clock__name">Neutral</span>
          <span className="clock__time">Shift time</span>
        </span>
      </button>
      {clocks.map((location) => (
        <Clock
          key={location.timeZone}
          location={location}
          now={now}
          active={displayZone === location.timeZone}
          onSelect={() => setDisplayZone(location.timeZone)}
        />
      ))}
    </div>
  );
}

/**
 * The clock strip when there is no room for the strip.
 *
 * Shows the zone currently being read, in its own sky, and puts the others one click away.
 * The point is that the *choice* survives the narrow viewport — what is lost is the
 * at-a-glance comparison of four skies, which is a luxury; being unable to say "show me
 * this in Sydney time" is not.
 */
function CollapsedClocks({
  clocks,
  now,
  displayZone,
  setDisplayZone,
}: {
  readonly clocks: readonly Location[];
  readonly now: string;
  readonly displayZone: string;
  readonly setDisplayZone: (zone: string) => void;
}) {
  const selected = clocks.find((location) => location.timeZone === displayZone);
  const phase = selected ? skyPhase(now, selected.timeZone) : undefined;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`clock${selected ? '' : ' clock--abstract'}`}
          {...(phase ? { 'data-phase': phase } : {})}
          aria-label="Display timezone"
          title="Choose which timezone every time on screen is read in"
        >
          {phase ? <SkyIcon phase={phase} /> : null}
          <span className="clock__text">
            <span className="clock__name">{selected ? selected.name : 'Reading in'}</span>
            <span className="clock__time">
              {selected ? formatInZone(now, selected.timeZone) : 'Shift time'}
            </span>
          </span>
          <span aria-hidden className="clock__caret">
            ▾
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="popover">
          <div className="menu-label">Read every time in</div>
          <div
            className="flex flex-col gap-1 p-1"
            role="radiogroup"
            aria-label="Display timezone"
          >
            <button
              type="button"
              className="clock clock--abstract w-full"
              role="radio"
              aria-checked={displayZone === 'shift'}
              data-active={displayZone === 'shift'}
              onClick={() => setDisplayZone('shift')}
            >
              <span className="clock__text">
                <span className="clock__name">Neutral</span>
                <span className="clock__time">Shift time</span>
              </span>
            </button>
            {clocks.map((location) => (
              <Clock
                key={location.timeZone}
                location={location}
                now={now}
                active={displayZone === location.timeZone}
                onSelect={() => setDisplayZone(location.timeZone)}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Masthead() {
  const caps = useCapabilities();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || caps.administersSomewhere);
  // Settings edits are component state, so navigating away discards them. This is the only
  // place that can ask first: there is no route-level blocker without a data router, and
  // the alternative — losing twenty typed rows to a mis-click on "Schedule" — was silent.
  const unsavedAdminChanges = useUi((s) => s.unsavedAdminChanges);

  return (
    <nav
      className="masthead masthead--foot flex h-11 shrink-0 items-end gap-1 px-4"
      aria-label="Sections"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="tab"
          onClick={(event) => {
            if (unsavedAdminChanges === 0) return;
            const word = unsavedAdminChanges === 1 ? 'change' : 'changes';
            if (!window.confirm(`${unsavedAdminChanges} unsaved settings ${word} will be discarded. Leave anyway?`)) {
              event.preventDefault();
            }
          }}
        >
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
