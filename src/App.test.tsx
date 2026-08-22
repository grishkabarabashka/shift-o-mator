/**
 * @vitest-environment jsdom
 *
 * Дымовые тесты оболочки и экрана планирования.
 *
 * Проверяются контракты, а не разметка: сетка строится из единицы, правка сама
 * открывает черновик и не трогает опубликованные данные, пикер предлагает
 * только роли этого дня, покрытие и нарушения пересчитываются, публикация
 * блокируется дырами.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { scheduleRepository } from './data/memoryRepository.ts';
import { DEFAULT_UNIT } from './domain/fixtures.ts';
import { ALL_UNITS } from './domain/types.ts';
import { useSchedule } from './store/useSchedule.ts';
import { TODAY, useUi } from './store/useUi.ts';
import { rangeFor } from './engine/period.ts';

beforeEach(async () => {
  await scheduleRepository.reset();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  useUi.setState({
    selection: { anchor: undefined, focus: undefined },
    highlightDate: undefined,
    activeRoleId: undefined,
    clipboard: undefined,
    issueFilter: 'ALL',
    absenceDraft: undefined,
    compDayDraft: undefined,
    // Дефолт приложения — «все единицы» (ADR-0020): сбрасываемся в него, а
    // не в конкретный регион, иначе тесты проверяют не то состояние, которое
    // видит пользователь при открытии.
    unitId: ALL_UNITS,
    zoom: 'month',
    anchor: TODAY,
    range: rangeFor('month', TODAY),
    custom: false,
  });
});

/**
 * Приложение открывается на Overview — планирование за одной вкладкой.
 * Единица задаётся до рендера: сетка грузится под неё одним проходом.
 */
async function renderSchedule(unitId: string = DEFAULT_UNIT) {
  useUi.setState({ unitId });
  const utils = render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
  await screen.findByRole('grid', {}, { timeout: 10000 });
  return utils;
}

function grid() {
  return screen.getByRole('grid');
}

function cellAt(personId: string, date: string): HTMLElement {
  const cell = grid().querySelector<HTMLElement>(
    `[data-person="${personId}"][data-date="${date}"]`,
  );
  if (!cell) throw new Error(`Cell ${personId}/${date} not found`);
  return cell;
}

/** Человек единицы, умеющий Cover, и его свободный будний день. */
function freeCoverCell(): { personId: string; date: string; roleId: string } {
  const state = useSchedule.getState();
  const role = state.reference?.roles.find((r) => r.regionId === 'AMER' && r.code === 'Cover');
  const person = state.reference?.people.find(
    (p) =>
      p.unitId === DEFAULT_UNIT &&
      p.isIncluded &&
      p.eligibility.some((e) => e.roleId === role?.id),
  );
  if (!role || !person) throw new Error('No suitable person in fixtures');

  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const busy = state.plan?.assignments.some((a) => a.personId === person.id && a.date === date);
    const absent = state.plan?.absences.some(
      (a) => a.personId === person.id && date >= a.from && date <= a.to,
    );
    if (!busy && !absent) return { personId: person.id, date, roleId: role.id };
  }
  throw new Error('Person has no free weekday');
}

function cellRoleId(personId: string, date: string): string | undefined {
  const assignment = useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date);
  return assignment?.content.kind === 'ROLE' ? assignment.content.roleId : undefined;
}

describe('оболочка', () => {
  it('открывается на Overview и даёт перейти во все разделы', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 }),
    ).toBeInTheDocument();

    for (const name of ['Overview', 'Schedule', 'People', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    // Дашборд и таймлайн больше не отдельные вкладки.
    expect(screen.queryByRole('link', { name: 'Timeline' })).toBeNull();
  });

  it('Overview показывает все регионы сразу, без выбора единицы', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 });

    // ALL по умолчанию: в ленте должны быть дорожки всех трёх регионов.
    for (const region of ['Americas', 'EMEA', 'APAC']) {
      expect(screen.getAllByText(region).length).toBeGreaterThan(0);
    }
  });

  it('People считает нагрузку и долг по отгулам', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'People' }, { timeout: 10000 }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Weekends')).toBeInTheDocument();
    expect(within(table).getByText('Comp owed')).toBeInTheDocument();
  });

  it('Settings показывает реальные коды ролей региона', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }, { timeout: 10000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roles' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Batch-E')).toBeInTheDocument();
  });
});

describe('выбор периода', () => {
  it('масштаб меняет число колонок', async () => {
    await renderSchedule();
    const monthColumns = grid().querySelectorAll('.sheet__head').length;

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => {
      expect(grid().querySelectorAll('.sheet__head').length).toBe(7);
    });
    expect(monthColumns).toBeGreaterThan(7);
  });

  it('шаг вперёд и Today возвращают период с сегодняшним днём', async () => {
    await renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await waitFor(() => {
      expect(useUi.getState().range.from > TODAY).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => {
      const { range } = useUi.getState();
      expect(range.from <= TODAY && TODAY <= range.to).toBe(true);
    });
  });

  it('на трёх месяцах сетка становится тепловой картой только на чтение', async () => {
    await renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: '3 Months' }));
    await waitFor(() => {
      expect(screen.queryByRole('grid')).toBeNull();
    });
    expect(screen.getByRole('button', { name: /Switch to Month to edit/ })).toBeInTheDocument();
  });
});

describe('сетка', () => {
  it('рисует людей единицы и дни месяца', async () => {
    await renderSchedule();
    const cells = grid().querySelectorAll('[role="gridcell"]');
    const people = useSchedule
      .getState()
      .reference?.people.filter((p) => p.unitId === DEFAULT_UNIT && p.isIncluded);

    expect(people?.length).toBeGreaterThan(0);
    expect(cells.length).toBe((people?.length ?? 0) * 31);
  });

  it('группирует по локации, как задано в единице', async () => {
    await renderSchedule();
    const headers = [...grid().querySelectorAll('.sheet__group')].map((el) =>
      el.textContent?.replace(/\d+/g, '').trim(),
    );
    expect(headers).toContain('Chicago');
    expect(headers).toContain('New York');
    expect(headers).toContain('Pune');
  });

  it('показывает реальные коды ролей и их окна на палитре', async () => {
    await renderSchedule();
    const palette = screen.getByRole('toolbar', { name: 'Roles' });
    expect(within(palette).getByText('Lead')).toBeInTheDocument();
    expect(within(palette).getByText('Batch-E')).toBeInTheDocument();
  });
});

describe('черновик', () => {
  it('правка сама открывает черновик — режим Edit искать не нужно', async () => {
    await renderSchedule();
    const { personId, date, roleId } = freeCoverCell();
    expect(useSchedule.getState().session).toBeUndefined();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });

    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBe(roleId);
    });
    expect(useSchedule.getState().session).toBeDefined();
  });

  it('правка в черновике не трогает опубликованные данные', async () => {
    await renderSchedule();
    const { personId, date, roleId } = freeCoverCell();
    const publishedBefore = useSchedule.getState().published?.assignments.length;

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });

    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBe(roleId);
    });
    expect(useSchedule.getState().published?.assignments.length).toBe(publishedBefore);
  });

  it('Ctrl+Z возвращает правку', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBeDefined();
    });

    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBeUndefined();
    });
  });
});

describe('пикер назначения', () => {
  it('открывается правым кликом и в режиме чтения', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();
    expect(useSchedule.getState().session).toBeUndefined();

    fireEvent.contextMenu(cellAt(personId, date));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('предлагает только роли конфигурации этого дня', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');

    // Пятничные роли в понедельник–четверг не предлагаются, и наоборот.
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 5) expect(within(menu).queryByText('Lead')).toBeNull();
    else expect(within(menu).queryByText('Lead-E')).toBeNull();
  });

  it('никогда не предлагает роли другого региона', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    // `M` — роль APAC.
    expect(within(menu).queryByText('M')).toBeNull();
  });

  it('ставит роль из меню', async () => {
    await renderSchedule();
    const { personId, date, roleId } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('Cover'));

    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBe(roleId);
    });
  });

  it('ставит маркер `0`, отличный от пустой ячейки', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('0 — not scheduled'));

    await waitFor(() => {
      const assignment = useSchedule
        .getState()
        .plan?.assignments.find((a) => a.personId === personId && a.date === date);
      expect(assignment?.content).toEqual({ kind: 'MARKER', marker: 'NOT_SCHEDULED' });
    });
  });
});

describe('покрытие и нарушения', () => {
  it('полоса покрытия показывает факт против минимума', async () => {
    await renderSchedule();
    const strip = screen.getByRole('group', { name: 'Coverage' });
    const cells = within(strip).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((cell) => /^\d+\/\d+$/.test(cell.textContent ?? ''))).toBe(true);
  });

  it('различает дыру и покрытие впритык', async () => {
    await renderSchedule();
    const strip = screen.getByRole('group', { name: 'Coverage' });
    const levels = new Set(
      within(strip)
        .getAllByRole('button')
        .map((cell) => cell.dataset.level),
    );
    expect(levels.has('GAP')).toBe(true);
    expect(levels.has('THIN')).toBe(true);
  });

  it('панель нарушений разводит дыры и конфликты', async () => {
    await renderSchedule();
    const panel = screen.getByRole('complementary', { name: 'Issues' });
    expect(within(panel).getByRole('button', { name: /Gaps/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Conflicts/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Warnings/ })).toBeInTheDocument();
  });

  it('дашборд ведёт из дыры в нужную ячейку сетки', async () => {
    render(<App />);
    const fix = await screen.findAllByText('Fix →', {}, { timeout: 10000 });
    fireEvent.click(fix[0]!);

    await screen.findByRole('grid', {}, { timeout: 10000 });
    // У дыры нет человека — переход ведёт в колонку дня, а не в чужую строку.
    expect(useUi.getState().highlightDate).toBeDefined();
  });
});

describe('публикация', () => {
  it('review показывает diff и блокируется дырами', async () => {
    await renderSchedule();
    const { personId, date, roleId } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(cellRoleId(personId, date)).toBe(roleId);
    });

    fireEvent.click(await screen.findByRole('button', { name: /Review & publish/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/created/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(within(dialog).getByText(/Publication is blocked/)).toBeInTheDocument();
  });

  it('черновик переживает закрытие review', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
    });

    fireEvent.click(await screen.findByRole('button', { name: /Review & publish/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
  });
});
