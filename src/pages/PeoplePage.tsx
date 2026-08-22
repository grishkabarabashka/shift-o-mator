/**
 * People: ростер, справедливость нагрузки и баланс отгулов.
 *
 * Отвечает на «кто в команде, что человек умеет, сколько отработал и сколько
 * ему должны». Последнее — не отчётность: отгул, о котором забыли, обнаружится
 * заявлением на увольнение, а не письмом.
 *
 * Контекст ростера — контрактное окно человека (`ShiftDefinition`), а не время
 * роли: «Pune EMEA 13:00–21:30 IST» — это про человека, а «Crew 09:00–18:00
 * Chicago» — про работу (ADR-0018). Смешивать их на одном экране нельзя.
 */

import { useMemo, useState } from 'react';
import type { IsoDate, Person, ShiftRole } from '../domain/types.ts';
import { eachDate } from '../engine/dates.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { useUi } from '../store/useUi.ts';
import { PersonEditor } from '../features/people/PersonEditor.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  readonly asOf: IsoDate;
}

interface PersonStats {
  readonly person: Person;
  readonly locationName: string;
  readonly regionName: string;
  readonly shiftLabel: string;
  readonly worked: number;
  readonly weekends: number;
  readonly absent: number;
  readonly compOwed: number;
  readonly compAging: number;
  readonly roleMix: ReadonlyArray<{ code: string; color: string; count: number }>;
}

export function PeoplePage({ view, asOf }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  const range = useUi((s) => s.range);
  const index = useSchedule((s) => s.index);
  const plan = useSchedule((s) => s.plan);
  const reference = useSchedule((s) => s.reference);

  const stats = useMemo<PersonStats[]>(() => {
    if (!index || !plan) return [];
    const dates = new Set(eachDate(range));

    return view.rows
      .filter((row): row is Extract<typeof row, { kind: 'person' }> => row.kind === 'person')
      .map((row) => {
        const { person } = row;
        const assignments = (index.assignmentsByPerson.get(person.id) ?? []).filter((a) =>
          dates.has(a.date),
        );

        const byRole = new Map<string, number>();
        let worked = 0;
        let weekends = 0;
        for (const assignment of assignments) {
          if (assignment.content.kind !== 'ROLE') continue;
          worked += 1;
          if (assignment.isWeekend) weekends += 1;
          byRole.set(assignment.content.roleId, (byRole.get(assignment.content.roleId) ?? 0) + 1);
        }

        const absent = (index.absencesByPerson.get(person.id) ?? []).filter(
          (absence) => absence.from <= range.to && absence.to >= range.from,
        ).length;

        // Порог старения задаёт регион: отгул не сгорает, но слишком долго
        // висящий подсвечивается (ADR-0007).
        const agingDays =
          index.regions.get(person.regionId)?.compOffPolicy.agingThresholdDays ?? 14;
        const comps = index.compDaysByPerson.get(person.id) ?? [];
        const outstanding = comps.filter(
          (entry) => entry.status !== 'TAKEN' && entry.status !== 'DECLINED',
        );
        const aging = outstanding.filter(
          (entry) => daysSince(entry.earnedForDate, asOf) > agingDays,
        ).length;

        const roleMix = [...byRole.entries()]
          .map(([roleId, count]) => {
            const role = index.roles.get(roleId);
            return { code: role?.code ?? roleId, color: role?.color ?? 'var(--accent)', count };
          })
          .sort((a, b) => b.count - a.count);

        // Контрактное окно человека, а не время роли: разные вещи (ADR-0018).
        const shift = index.shifts.get(person.defaultShiftId);

        return {
          person,
          locationName: row.location.name,
          regionName: row.region.name,
          shiftLabel: shift ? `${shift.start}–${shift.end}` : '—',
          worked,
          weekends,
          absent,
          compOwed: outstanding.length,
          compAging: aging,
          roleMix,
        };
      });
  }, [view.rows, index, plan, range, reference, asOf]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stats;
    return stats.filter(
      (entry) =>
        entry.person.displayName.toLowerCase().includes(needle) ||
        entry.locationName.toLowerCase().includes(needle) ||
        entry.regionName.toLowerCase().includes(needle) ||
        entry.roleMix.some((role) => role.code.toLowerCase().includes(needle)),
    );
  }, [stats, query]);

  const selected = stats.find((entry) => entry.person.id === selectedId);

  // Ориентир справедливости — среднее по видимому ростеру. Абсолютной нормы
  // нет: она зависит от того, сколько выходных попало в период.
  const avgWeekends =
    stats.length > 0 ? stats.reduce((sum, entry) => sum + entry.weekends, 0) / stats.length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">People</h1>
        <span className="pill">{filtered.length}</span>
        <input
          className="field ml-auto w-[260px]"
          placeholder="Search name, region, location or role"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search people"
        />
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="card min-w-0 flex-1 overflow-auto">
          <table className="rows">
            <thead>
              <tr>
                <th>Name</th>
                {/* Со всеми единицами сразу локации мало: Pune и Chicago в
                    одном списке ничего не говорят о том, чьи это правила. */}
                <th>Region</th>
                <th>Location</th>
                <th>Shift</th>
                <th className="text-right">Worked</th>
                <th className="text-right">Weekends</th>
                <th className="text-right">Absent</th>
                <th className="text-right">Comp owed</th>
                <th>Roles</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.person.id}
                  data-selected={entry.person.id === selectedId}
                  onClick={() => setSelectedId(entry.person.id)}
                  className="cursor-pointer"
                >
                  <td className="font-medium whitespace-nowrap">{entry.person.displayName}</td>
                  <td className="whitespace-nowrap">
                    <span className="pill">{entry.regionName}</span>
                  </td>
                  <td className="whitespace-nowrap text-muted">{entry.locationName}</td>
                  <td className="font-mono text-[11.5px] whitespace-nowrap text-muted">
                    {entry.shiftLabel}
                  </td>
                  <td className="text-right font-mono">{entry.worked}</td>
                  <td
                    className={`text-right font-mono ${
                      entry.weekends > avgWeekends + 1 ? 'font-bold text-warn' : ''
                    }`}
                  >
                    {entry.weekends}
                  </td>
                  <td className="text-right font-mono text-muted">{entry.absent}</td>
                  <td className="text-right">
                    {entry.compOwed === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className={entry.compAging > 0 ? 'pill pill--warn' : 'pill'}>
                        {entry.compOwed}
                        {entry.compAging > 0 ? ' aging' : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="flex gap-1">
                      {entry.roleMix.slice(0, 4).map((role) => (
                        <span
                          key={role.code}
                          className="chip !w-auto px-1.5 py-0.5 text-[9.5px]"
                          style={{ background: role.color }}
                          title={`${role.code}: ${role.count} days`}
                        >
                          {role.code}
                        </span>
                      ))}
                      {entry.roleMix.length > 4 ? (
                        <span className="text-[10.5px] text-faint">
                          +{entry.roleMix.length - 4}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-muted">
              Nobody matches &ldquo;{query}&rdquo;.
            </p>
          ) : null}
        </div>

        {selected ? (
          <PersonPanel
            entry={selected}
            avgWeekends={avgWeekends}
            regionRoles={index?.rolesByRegion.get(selected.person.regionId) ?? []}
            onClose={() => setSelectedId(undefined)}
          />
        ) : null}
      </div>
    </div>
  );
}

type Tab = 'Activity' | 'Profile';

function PersonPanel({
  entry,
  avgWeekends,
  regionRoles,
  onClose,
}: {
  readonly entry: PersonStats;
  readonly avgWeekends: number;
  readonly regionRoles: readonly ShiftRole[];
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Activity');
  const total = entry.roleMix.reduce((sum, role) => sum + role.count, 0);
  const overloaded = entry.weekends > avgWeekends + 1;

  return (
    <aside className="card flex w-[330px] shrink-0 flex-col overflow-y-auto">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{entry.person.displayName}</h2>
          <p className="text-[12px] text-muted">
            {entry.locationName} · {entry.regionName}
          </p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost ml-auto" onClick={onClose}>
          ✕
        </button>
      </header>

      {/* Что было и что должно быть — разные вопросы: факт за период против
          настройки, которую читает автогенерация. */}
      <div className="border-b border-line px-4 py-2">
        <div className="segmented w-full">
          {(['Activity', 'Profile'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="segmented__item flex-1"
              data-active={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {tab === 'Profile' ? (
        <div className="p-4">
          <PersonEditor person={entry.person} regionRoles={regionRoles} onClose={onClose} />
        </div>
      ) : (
        <ActivityTab
          entry={entry}
          total={total}
          overloaded={overloaded}
          avgWeekends={avgWeekends}
        />
      )}
    </aside>
  );
}

function ActivityTab({
  entry,
  total,
  overloaded,
  avgWeekends,
}: {
  readonly entry: PersonStats;
  readonly total: number;
  readonly overloaded: boolean;
  readonly avgWeekends: number;
}) {
  return (
    <>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <Kpi label="Worked" value={entry.worked} />
        {overloaded ? (
          <Kpi label="Weekends" value={entry.weekends} tone="warn" />
        ) : (
          <Kpi label="Weekends" value={entry.weekends} />
        )}
        <Kpi label="Absent" value={entry.absent} />
      </div>

      {overloaded ? (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-[12px] text-warn">
          Above the roster average of {avgWeekends.toFixed(1)} weekend days — check before adding
          more.
        </p>
      ) : null}

      <section className="border-b border-line px-4 py-3">
        <h3 className="menu-label px-0">Comp days</h3>
        {entry.compOwed === 0 ? (
          <p className="text-[12.5px] text-muted">Nothing outstanding.</p>
        ) : (
          <div className="flex gap-2">
            <Tile label="Owed" value={entry.compOwed} />
            {entry.compAging > 0 ? (
              <Tile label="Aging" value={entry.compAging} tone="warn" />
            ) : null}
          </div>
        )}
      </section>

      <section className="px-4 py-3">
        <h3 className="menu-label px-0">Role mix</h3>
        {total === 0 ? (
          <p className="text-[12.5px] text-muted">No working days in this period.</p>
        ) : (
          <ul className="space-y-1.5">
            {entry.roleMix.map((role) => (
              <li key={role.code} className="flex items-center gap-2 text-[12px]">
                <span className="w-16 shrink-0 font-mono font-semibold">{role.code}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(role.count / total) * 100}%`, background: role.color }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right font-mono text-faint">{role.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line px-4 py-3">
        <h3 className="menu-label px-0">Eligible for</h3>
        <p className="text-[12px] text-muted">
          {entry.person.eligibility.length} role
          {entry.person.eligibility.length === 1 ? '' : 's'} in {entry.regionName}
        </p>
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'warn';
}) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className={`text-[20px] leading-none font-semibold ${tone === 'warn' ? 'text-warn' : ''}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium tracking-wide text-faint uppercase">{label}</div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'warn';
}) {
  return (
    <div
      className={`flex-1 rounded-lg border px-3 py-2 ${
        tone === 'warn' ? 'border-warn bg-warn-soft' : 'border-line bg-sunken'
      }`}
    >
      <div className={`text-[18px] leading-none font-semibold ${tone === 'warn' ? 'text-warn' : ''}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-faint">{label}</div>
    </div>
  );
}

function daysSince(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
