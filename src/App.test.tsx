/**
 * @vitest-environment jsdom
 *
 * Дымовой тест экрана планирования: сетка рисуется, клавиатура ставит роль,
 * полоса покрытия пересчитывается, Ctrl+Z возвращает.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { effectiveCompDayDate } from './domain/types.ts';
import { useSchedule } from './store/useSchedule.ts';
import { useUi } from './store/useUi.ts';

afterEach(() => {
  useUi.setState({
    selection: { anchor: undefined, focus: undefined },
    activeRoleId: undefined,
    clipboard: undefined,
    issueFilter: 'ALL',
    absenceDraft: undefined,
    compDayDraft: undefined,
  });
});

async function renderApp() {
  const utils = render(<App />);
  await screen.findByRole('grid', {}, { timeout: 5000 });
  return utils;
}

function grid() {
  return screen.getByRole('grid');
}

function cellAt(personId: string, date: string): HTMLElement {
  const cell = grid().querySelector<HTMLElement>(
    `[data-person="${personId}"][data-date="${date}"]`,
  );
  if (!cell) throw new Error(`Ячейка ${personId}/${date} не найдена`);
  return cell;
}

/** Человек единицы, умеющий CAVA, и его свободный день. */
function freeCavaCell(): { personId: string; date: string; roleId: string } {
  const state = useSchedule.getState();
  const role = state.reference?.roles.find((r) => r.unitId === 'unit-amer' && r.code === 'CAVA');
  const person = state.reference?.people.find(
    (p) => p.unitId === 'unit-amer' && !p.isPlannerOnly && p.eligibility.some((e) => e.roleId === role?.id),
  );
  if (!role || !person) throw new Error('В фикстурах нет подходящего человека');

  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    const busy = state.plan?.assignments.some((a) => a.personId === person.id && a.date === date);
    const absent = state.plan?.absences.some(
      (a) => a.personId === person.id && date >= a.from && date <= a.to,
    );
    if (!busy && !absent) return { personId: person.id, date, roleId: role.id };
  }
  throw new Error('У человека нет свободных дней');
}

/** Человек единицы, свободный (без назначения и без отсутствия) все три дня. */
function personWithFreeRange(dates: readonly string[]): string {
  const state = useSchedule.getState();
  const people = state.reference?.people.filter((p) => p.unitId === 'unit-amer' && !p.isPlannerOnly) ?? [];

  for (const person of people) {
    const busy = dates.some(
      (date) =>
        state.plan?.assignments.some((a) => a.personId === person.id && a.date === date) ||
        state.plan?.absences.some((a) => a.personId === person.id && date >= a.from && date <= a.to),
    );
    if (!busy) return person.id;
  }
  throw new Error('Нет человека со свободным диапазоном');
}

describe('экран планирования', () => {
  it('рисует людей единицы и дни месяца', async () => {
    await renderApp();
    const cells = grid().querySelectorAll('[role="gridcell"]');
    const people = useSchedule
      .getState()
      .reference?.people.filter((p) => p.unitId === 'unit-amer' && !p.isPlannerOnly);

    expect(people?.length).toBeGreaterThan(0);
    expect(cells.length).toBe((people?.length ?? 0) * 31);
  });

  it('показывает окно роли прямо на палитре', async () => {
    await renderApp();
    const palette = screen.getByRole('toolbar', { name: 'Роли' });
    expect(within(palette).getByText('SL')).toBeInTheDocument();
    expect(within(palette).getByText('07:00–15:00')).toBeInTheDocument();
  });

  it('ставит роль с клавиатуры и возвращает по Ctrl+Z', async () => {
    await renderApp();
    const { personId, date, roleId } = freeCavaCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'c' });

    await waitFor(() => {
      const assignment = useSchedule
        .getState()
        .plan?.assignments.find((a) => a.personId === personId && a.date === date);
      expect(assignment?.roleId).toBe(roleId);
    });
    expect(cellAt(personId, date).textContent).toContain('CAVA');

    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(cellAt(personId, date).textContent).not.toContain('CAVA');
    });
  });

  it('красит диапазон одним движением с Shift', async () => {
    await renderApp();
    const { personId, roleId } = freeCavaCell();
    const dates = ['2026-08-24', '2026-08-25', '2026-08-26'];

    fireEvent.mouseDown(cellAt(personId, dates[0] as string));
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'c' });

    await waitFor(() => {
      const assigned = useSchedule
        .getState()
        .plan?.assignments.filter(
          (a) => a.personId === personId && dates.includes(a.date) && a.roleId === roleId,
        );
      expect(assigned).toHaveLength(3);
    });
  });

  it('не ставит роль в день отсутствия', async () => {
    await renderApp();
    const state = useSchedule.getState();
    const absence = state.plan?.absences[0];
    expect(absence).toBeDefined();
    if (!absence) return;

    const cell = cellAt(absence.personId, absence.from);
    fireEvent.mouseDown(cell);
    fireEvent.keyDown(grid(), { key: 'c' });

    const assignment = useSchedule
      .getState()
      .plan?.assignments.find((a) => a.personId === absence.personId && a.date === absence.from);
    expect(assignment).toBeUndefined();
  });

  it('полоса покрытия показывает факт против минимума', async () => {
    await renderApp();
    const strip = screen.getByRole('region', { name: 'Покрытие' });
    const cells = within(strip).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((cell) => /^\d+\/\d+$/.test(cell.textContent ?? ''))).toBe(true);
    expect(cells.some((cell) => cell.dataset.level === 'BELOW_MIN')).toBe(true);
  });

  it('панель нарушений заполнена и фильтруется', async () => {
    await renderApp();
    const panel = screen.getByRole('complementary', { name: 'Нарушения' });
    expect(within(panel).getAllByRole('button', { name: /./ }).length).toBeGreaterThan(4);

    fireEvent.click(within(panel).getByText('Блокеры'));
    await waitFor(() => {
      expect(within(panel).getAllByText('BLK').length).toBeGreaterThan(0);
    });
    expect(within(panel).queryByText('INF')).toBeNull();
  });
});

describe('отсутствия', () => {
  it('создаёт отсутствие через выделение и диалог', async () => {
    await renderApp();
    const dates = ['2026-08-24', '2026-08-25', '2026-08-26'];
    const personId = personWithFreeRange(dates);

    fireEvent.mouseDown(cellAt(personId, dates[0] as string));
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true });

    fireEvent.click(screen.getByRole('button', { name: /Отсутствие/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      const absence = useSchedule
        .getState()
        .plan?.absences.find(
          (a) => a.personId === personId && a.from === dates[0] && a.to === dates[2],
        );
      expect(absence).toBeDefined();
      expect(absence?.type).toBe('VACATION');
      expect(absence?.source).toBe('MANUAL');
    });

    expect(cellAt(personId, dates[1] as string).dataset.absent).toBe('true');
  });

  it('не предлагает отсутствие без выделения', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: /Отсутствие/ })).toBeDisabled();
  });

  it('правит и удаляет отсутствие через двойной клик', async () => {
    await renderApp();
    const absence = useSchedule.getState().plan?.absences[0];
    expect(absence).toBeDefined();
    if (!absence) return;

    fireEvent.doubleClick(cellAt(absence.personId, absence.from));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(new RegExp(absence.from))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));

    await waitFor(() => {
      const stillThere = useSchedule.getState().plan?.absences.some((a) => a.id === absence.id);
      expect(stillThere).toBe(false);
    });
  });
});

/** Отгул, чья эффективная дата видна в текущей открытой сетке (август). */
function proposedCompDayInAugust() {
  const entry = useSchedule
    .getState()
    .plan?.compDays.find((e) => {
      if (e.status !== 'PROPOSED') return false;
      const date = effectiveCompDayDate(e);
      return date >= '2026-08-01' && date <= '2026-08-31';
    });
  if (!entry) throw new Error('Нет предложенного отгула в августе');
  return entry;
}

describe('отгулы', () => {
  it('подтверждает предложенный отгул через диалог', async () => {
    await renderApp();
    const entry = proposedCompDayInAugust();
    const date = effectiveCompDayDate(entry);

    fireEvent.doubleClick(cellAt(entry.personId, date));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => {
      const updated = useSchedule.getState().plan?.compDays.find((e) => e.id === entry.id);
      expect(updated?.status).toBe('SCHEDULED');
      expect(updated?.actualDate).toBe(date);
    });
  });

  it('подтверждённый отгул после этого блокирует назначение в сетке', async () => {
    await renderApp();
    const entry = proposedCompDayInAugust();
    const date = effectiveCompDayDate(entry);

    fireEvent.doubleClick(cellAt(entry.personId, date));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => {
      expect(cellAt(entry.personId, date).dataset.absent).toBe('true');
    });
  });
});
