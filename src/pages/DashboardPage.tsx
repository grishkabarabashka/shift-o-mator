/**
 * Дашборд — посадочный экран.
 *
 * Отвечает ровно на два вопроса, в этом порядке: **закрыты ли мы сейчас** и
 * **где надо вмешаться.** Всё остальное — навигация к этим ответам.
 *
 * Поэтому «Attention required» исчезает, когда чинить нечего: постоянно
 * висящая пустая карточка приучает её не читать, и в день, когда в ней
 * появится дыра, её тоже не прочитают.
 *
 * Каждая строка ведёт в конкретную ячейку сетки (спека §4.1). Список проблем,
 * из которого нельзя перейти к починке, — это отчёт, а не рабочий инструмент.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { Issue } from '../domain/types.ts';
import { eachDate, parseDate } from '../engine/dates.ts';
import { buildTimelineDay, positionOf } from '../engine/timeline.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { TODAY, useUi } from '../store/useUi.ts';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

interface Props {
  readonly view: PlanningView;
  readonly now: string;
}

export function DashboardPage({ view, now }: Props) {
  const navigate = useNavigate();
  const range = useUi((s) => s.range);
  const select = useUi((s) => s.select);
  const focusDate = useUi((s) => s.focusDate);
  const setAnchor = useUi((s) => s.setAnchor);
  const index = useSchedule((s) => s.index);
  const plan = useSchedule((s) => s.plan);

  const today = useMemo(() => {
    if (!plan || !index) return undefined;
    return buildTimelineDay({
      date: TODAY,
      regionIds: view.regionIds,
      assignments: plan.assignments,
      coverageCells: view.coverageCells,
      index,
    });
  }, [plan, index, view.regionIds, view.coverageCells]);

  const onShift = today?.lanes.reduce(
    (sum, lane) => sum + lane.blocks.reduce((n, block) => n + block.people.length, 0),
    0,
  );

  const blocking = view.issues.filter((issue) => issue.level === 'BLOCKING');
  const gaps = blocking.filter((issue) => issue.category === 'GAP');
  const conflicts = blocking.filter((issue) => issue.category === 'CONFLICT');

  /** Дней периода, в которых есть хоть одна дыра. */
  const gapDays = useMemo(() => {
    const dates = new Set(gaps.map((issue) => issue.date).filter(Boolean));
    return dates.size;
  }, [gaps]);

  const people = view.rows.filter((row) => row.kind === 'person').length;

  /**
   * У дыры нет человека — никто не назначен, в этом она и состоит. Поэтому
   * конфликт ведёт в ячейку, а дыра — в колонку дня.
   */
  const goToIssue = (issue: Issue) => {
    if (!issue.date) return;
    setAnchor(issue.date);
    if (issue.personId) select({ personId: issue.personId, date: issue.date });
    focusDate(issue.date, issue.personId);
    void navigate('/schedule');
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Dashboard</h1>
        <p className="text-[13px] text-muted">{parseDate(TODAY).toFormat('cccc, d LLLL yyyy')}</p>
      </header>

      <section className="card grid grid-cols-2 divide-x divide-line md:grid-cols-3 lg:grid-cols-6">
        <Stat label="On shift today" value={onShift ?? 0} />
        <Stat label="Regions" value={view.regionIds.length} />
        <Stat label="Gaps" value={gaps.length} tone={gaps.length > 0 ? 'bad' : 'ok'} />
        <Stat
          label="Conflicts"
          value={conflicts.length}
          tone={conflicts.length > 0 ? 'bad' : 'ok'}
        />
        <Stat label="Gap days in period" value={gapDays} tone={gapDays > 0 ? 'warn' : 'ok'} />
        <Stat label="People" value={people} />
      </section>

      {blocking.length > 0 ? (
        <section className="card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-[13.5px] font-semibold">Attention required</h2>
            <span className="pill pill--bad">{blocking.length}</span>
            <span className="ml-auto text-[11.5px] text-faint">
              Publication is blocked until these are resolved
            </span>
          </header>
          <ul className="max-h-[280px] overflow-y-auto">
            {blocking.slice(0, 60).map((issue) => (
              <li key={issue.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-0 hover:bg-hover"
                  onClick={() => goToIssue(issue)}
                >
                  <span className={`pill ${issue.category === 'GAP' ? 'pill--bad' : 'pill--warn'}`}>
                    {issue.category}
                  </span>
                  {issue.date ? (
                    <span className="shrink-0 font-mono text-[11.5px] text-muted">
                      {parseDate(issue.date).toFormat('ccc d LLL')}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{issue.message}</span>
                  <span className="shrink-0 text-[11px] text-accent">Fix →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card flex items-center gap-3 px-4 py-3">
          <span className="pill pill--ok">All clear</span>
          <span className="text-[13px] text-muted">
            Every requirement in {rangeLabel(range.from, range.to)} is met and nothing conflicts.
          </span>
        </section>
      )}

      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold">Right now</h2>
          <span className="ml-auto font-mono text-[11.5px] text-faint">
            {new Date(now).toISOString().slice(11, 16)} UTC
          </span>
        </header>

        <div className="space-y-2 p-4">
          {today?.lanes.length ? (
            today.lanes.map((lane) => {
              const live = lane.blocks.filter(
                (block) => block.interval.start <= now && now < block.interval.end,
              );
              const headcount = live.reduce((sum, block) => sum + block.people.length, 0);
              // Ноль вне рабочего окна региона — норма, а не дыра: красным
              // подсвечивается только пустая смена внутри окна.
              const offHours = live.length === 0;
              return (
                <div key={lane.regionId} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[12px] font-semibold text-muted">
                    {lane.regionName}
                  </span>
                  <span
                    className={`pill w-24 justify-center ${
                      offHours ? '' : headcount > 0 ? 'pill--ok' : 'pill--bad'
                    }`}
                  >
                    {offHours ? 'off hours' : `${headcount} on shift`}
                  </span>
                  {/* Минибар суток: где регион работает и где мы сейчас. */}
                  <div className="lane h-5 flex-1">
                    {lane.blocks.map((block) => (
                      <span
                        key={block.roleId}
                        className="lane__block"
                        style={{
                          left: `${positionOf(today.axis, block.interval.start) * 100}%`,
                          width: `${(positionOf(today.axis, block.interval.end) - positionOf(today.axis, block.interval.start)) * 100}%`,
                          background: block.empty ? 'var(--bad-soft)' : block.color,
                          opacity: block.empty ? 0.7 : 1,
                        }}
                        title={`${block.code} ${block.filled}/${block.required}`}
                      />
                    ))}
                    <span
                      className="lane__now"
                      style={{ left: `${positionOf(today.axis, now) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 truncate text-right font-mono text-[11px] text-faint">
                    {live.map((block) => block.code).join(', ') || '—'}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-[13px] text-muted">No configuration applies to today.</p>
          )}
        </div>

        <footer className="border-t border-line px-4 py-2">
          <button type="button" className="btn btn--sm" onClick={() => void navigate('/timeline')}>
            Open full timeline →
          </button>
        </footer>
      </section>
    </div>
  );
}

function rangeLabel(from: string, to: string): string {
  const days = eachDate({ from, to }).length;
  return `${parseDate(from).toFormat('d LLL')} – ${parseDate(to).toFormat('d LLL')} (${days} days)`;
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' && value > 0
      ? 'text-bad'
      : tone === 'warn' && value > 0
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : '';
  return (
    <div className="px-4 py-3">
      <div className={`text-[26px] leading-none font-semibold tracking-tight ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium tracking-wide text-faint uppercase">{label}</div>
    </div>
  );
}
