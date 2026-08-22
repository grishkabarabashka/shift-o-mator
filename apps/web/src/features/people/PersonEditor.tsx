/**
 * Редактор профиля инженера: доли ролей, доступные дни, пожелания.
 *
 * Это вход в автогенерацию. Целевая доля — не отчётность: она задаёт, какую
 * часть смен человека система должна отдавать этой роли, и без неё
 * автоподстановка распределяет роли ровно, чего в жизни не бывает — кто-то
 * тянет батчи, кто-то ведёт смену.
 *
 * Доли задаются **в процентах и нормализуются к 100** (ADR-0006 держит их как
 * доли 0…1). Планировщик думает «Priya — треть Batch-L», а не «0.33», и
 * набранная от руки сумма 95% или 110% не должна ничего ломать: показываем
 * фактический итог и нормализуем при сохранении.
 *
 * Пишется мимо черновика: это настройка, а не правка расписания (ADR-0015).
 */

import { useEffect, useMemo, useState } from 'react';
import type { Person, ShiftEligibility, Shift, Weekday } from '../../domain/types.ts';
import { useSchedule } from '../../store/useSchedule.ts';

const WEEKDAYS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

interface Props {
  readonly person: Person;
  readonly unitShifts: readonly Shift[];
  readonly onClose: () => void;
}

interface DraftState {
  /** Проценты, не доли: так их вводит человек. */
  readonly shares: ReadonlyMap<string, number>;
  readonly available: ReadonlySet<Weekday>;
  readonly avoids: ReadonlySet<Weekday>;
  readonly note: string;
}

function initialState(person: Person): DraftState {
  return {
    shares: new Map(
      person.eligibility.map((e) => [e.shiftId, Math.round(e.targetShare * 100)]),
    ),
    available: new Set(person.availableWeekdays),
    avoids: new Set(person.preferences?.avoidsWeekdays ?? []),
    note: person.preferences?.note ?? '',
  };
}

export function PersonEditor({ person, unitShifts, onClose }: Props) {
  const savePerson = useSchedule((s) => s.savePerson);
  const [draft, setDraft] = useState<DraftState>(() => initialState(person));
  const [saving, setSaving] = useState(false);

  // Переключение человека в таблице должно сбрасывать несохранённую правку,
  // иначе доли Priya молча уедут в профиль Karan.
  useEffect(() => setDraft(initialState(person)), [person]);

  const total = useMemo(
    () => [...draft.shares.values()].reduce((sum, value) => sum + value, 0),
    [draft.shares],
  );

  const dirty = useMemo(() => !sameAs(draft, person), [draft, person]);

  const setShare = (shiftId: string, percent: number | undefined) => {
    const shares = new Map(draft.shares);
    if (percent === undefined) shares.delete(shiftId);
    else shares.set(shiftId, Math.max(0, Math.min(100, percent)));
    setDraft({ ...draft, shares });
  };

  const toggleIn = (set: ReadonlySet<Weekday>, day: Weekday): Set<Weekday> => {
    const next = new Set(set);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    return next;
  };

  const save = async () => {
    setSaving(true);
    try {
      await savePerson(applyTo(person, draft));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="flex items-baseline gap-2">
          <h3 className="menu-label px-0">Shift mix for auto-populate</h3>
          <span
            className={`ml-auto text-[11px] ${total === 100 ? 'text-ok' : 'text-warn'}`}
            title={
              total === 100
                ? 'Shares add up'
                : 'Shares are normalized to 100% on save — the ratio between them is what matters'
            }
          >
            {total}%
          </span>
        </div>

        <ul className="mt-1 space-y-1.5">
          {unitShifts.map((shift) => {
            const percent = draft.shares.get(shift.id);
            const eligible = percent !== undefined;
            return (
              <li key={shift.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={eligible}
                  aria-label={`Eligible for ${shift.code}`}
                  onChange={() => setShare(shift.id, eligible ? undefined : 10)}
                />
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: shift.color, opacity: eligible ? 1 : 0.3 }}
                />
                <span
                  className={`w-[70px] shrink-0 font-mono text-[11.5px] ${
                    eligible ? 'font-semibold' : 'text-faint'
                  }`}
                  title={shift.label}
                >
                  {shift.code}
                </span>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={percent ?? 0}
                  disabled={!eligible}
                  aria-label={`${shift.code} target share`}
                  className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-30"
                  onChange={(event) => setShare(shift.id, Number(event.target.value))}
                />
                <span
                  className={`w-9 shrink-0 text-right font-mono text-[11px] ${
                    eligible ? '' : 'text-faint'
                  }`}
                >
                  {eligible ? `${percent}%` : '—'}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[10.5px] text-faint">
          Unchecking a shift removes it from this person&rsquo;s eligibility entirely.
        </p>
      </section>

      <section>
        <h3 className="menu-label px-0">Available weekdays</h3>
        <WeekdayRow
          selected={draft.available}
          onToggle={(day) => setDraft({ ...draft, available: toggleIn(draft.available, day) })}
        />
      </section>

      <section>
        <h3 className="menu-label px-0">Prefers to avoid</h3>
        <WeekdayRow
          tone="warn"
          selected={draft.avoids}
          onToggle={(day) => setDraft({ ...draft, avoids: toggleIn(draft.avoids, day) })}
        />
        <p className="mt-1 text-[10.5px] text-faint">
          A preference, not a rule — generation avoids these, planners may override.
        </p>
      </section>

      <section>
        <h3 className="menu-label px-0">Note</h3>
        <textarea
          className="field h-16 w-full resize-none py-1.5 leading-snug"
          value={draft.note}
          placeholder="Anything a planner should know"
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!dirty || saving}
          onClick={() => setDraft(initialState(person))}
        >
          Reset
        </button>
        <button type="button" className="btn btn--sm btn--ghost ml-auto" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function WeekdayRow({
  selected,
  onToggle,
  tone,
}: {
  readonly selected: ReadonlySet<Weekday>;
  readonly onToggle: (day: Weekday) => void;
  readonly tone?: 'warn';
}) {
  return (
    <div className="mt-1 flex gap-1">
      {WEEKDAYS.map((day) => (
        <button
          key={day.value}
          type="button"
          className="day-chip"
          data-selected={tone === undefined && selected.has(day.value)}
          data-warn={tone === 'warn' && selected.has(day.value)}
          onClick={() => onToggle(day.value)}
        >
          <span className="day-chip__num text-[10.5px]">{day.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Проценты обратно в доли. Нормализация к сумме, а не к 100: планировщик
 * задаёт соотношение, и 30/30/30 должно значить то же, что 33/33/33.
 */
function applyTo(person: Person, draft: DraftState): Person {
  const total = [...draft.shares.values()].reduce((sum, value) => sum + value, 0);
  const previous = new Map(person.eligibility.map((e) => [e.shiftId, e]));

  const eligibility: ShiftEligibility[] = [...draft.shares.entries()].map(([shiftId, percent]) => {
    const before = previous.get(shiftId);
    return {
      ...(before ?? {}),
      shiftId,
      targetShare: total > 0 ? Math.round((percent / total) * 1000) / 1000 : 0,
    };
  });

  const preferences = {
    ...person.preferences,
    ...(draft.avoids.size > 0 ? { avoidsWeekdays: [...draft.avoids].sort() } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
  const hasPreferences = Object.keys(preferences).length > 0;

  return {
    ...person,
    eligibility,
    availableWeekdays: [...draft.available].sort(),
    ...(hasPreferences ? { preferences } : {}),
  };
}

function sameAs(draft: DraftState, person: Person): boolean {
  const current = initialState(person);
  return (
    sameMap(draft.shares, current.shares) &&
    sameSet(draft.available, current.available) &&
    sameSet(draft.avoids, current.avoids) &&
    draft.note === current.note
  );
}

function sameMap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
