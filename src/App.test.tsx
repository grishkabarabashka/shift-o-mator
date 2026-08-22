/**
 * @vitest-environment jsdom
 *
 * Дымовые тесты оболочки и экрана планирования — реворкнуто на HTTP (Phase 5
 * step 6). Раньше гоняли `App` против `MemoryScheduleRepository` и ~700 строк
 * `domain/fixtures.ts`, оба удалены с переходом на HTTP. Здесь — MSW
 * (`testUtils/mockApi.ts`) перехватывает реальные `fetch()`, и компактный
 * фикстур-датасет (`testUtils/mockDataset.ts`) с двумя регионами (AMER, EMEA)
 * вместо прежних трёх — юнит-тестам оболочки третий регион не нужен, чтобы
 * доказать то же самое: единица показывает свои локации, регион — не показанные.
 *
 * Проверяются контракты, а не разметка: сетка строится из единицы, правка сама
 * открывает черновик и не трогает опубликованные данные, пикер предлагает
 * только роли этого дня, покрытие и нарушения пересчитываются, публикация
 * блокируется дырами.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { queryClient } from './api/queryClient.ts';
import { ALL_UNITS } from './domain/types.ts';
import { rangeFor } from './engine/period.ts';
import { useSchedule } from './store/useSchedule.ts';
import { TODAY, useUi } from './store/useUi.ts';
import { resetMockApi, server } from './testUtils/mockApi.ts';
import { DEFAULT_UNIT } from './testUtils/mockDataset.ts';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  resetMockApi();
  queryClient.clear();
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

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

/**
 * Приложение открывается на Overview — планирование за одной вкладкой.
 * Единица задаётся до рендера: сетка грузится под неё одним проходом.
 */
async function renderSchedule(unitId: string = DEFAULT_UNIT) {
  useUi.setState({ unitId });
  const utils = renderApp();
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
  if (!role || !person) throw new Error('No suitable person in the mock dataset');

  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    return { personId: person.id, date, roleId: role.id };
  }
  throw new Error('No weekday found');
}

function cellRoleId(personId: string, date: string): string | undefined {
  const assignment = useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date);
  return assignment?.content.kind === 'ROLE' ? assignment.content.roleId : undefined;
}

describe('оболочка', () => {
  it('открывается на Overview и даёт перейти во все разделы', async () => {
    renderApp();
    expect(
      await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 }),
    ).toBeInTheDocument();

    for (const name of ['Overview', 'Schedule', 'People', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    // Дашборд и таймлайн больше не отдельные вкладки.
    expect(screen.queryByRole('link', { name: 'Timeline' })).toBeNull();
  });

  it('Overview показывает регионы сразу, без выбора единицы', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 });

    // ALL по умолчанию: в ленте должны быть дорожки обоих регионов мока.
    for (const region of ['Americas', 'EMEA']) {
      expect(screen.getAllByText(region).length).toBeGreaterThan(0);
    }
  });

  it('People считает нагрузку и долг по отгулам', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'People' }, { timeout: 10000 }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Weekends')).toBeInTheDocument();
    expect(within(table).getByText('Comp owed')).toBeInTheDocument();
  });

  it('Settings показывает реальные коды ролей региона', async () => {
    renderApp();
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

    // Пятничные роли в понедельник–четверг не предлагаются, и наоборот
    // (fixture: weekday config runs Lead, friday config runs Lead-E).
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 5) expect(within(menu).queryByText('Lead')).toBeNull();
    else expect(within(menu).queryByText('Lead-E')).toBeNull();
  });

  it('никогда не предлагает роли другого региона', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    // `M` — роль EMEA.
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
    // Пустой мок-план: ничего не заполнено, значит каждая требуемая роль — дыра.
    expect(levels.has('GAP')).toBe(true);
  });

  it('панель нарушений разводит дыры и конфликты', async () => {
    await renderSchedule();
    const panel = screen.getByRole('complementary', { name: 'Issues' });
    expect(within(panel).getByRole('button', { name: /Gaps/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Conflicts/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Warnings/ })).toBeInTheDocument();
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
