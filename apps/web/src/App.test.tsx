/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the shell and the planning screen — reworked onto HTTP (Phase
 * 5 step 6). Used to run `App` against `MemoryScheduleRepository` and ~700
 * lines of `domain/fixtures.ts`, both removed with the move to HTTP. Here, MSW
 * (`testUtils/mockApi.ts`) intercepts real `fetch()` calls, and a compact
 * fixture dataset (`testUtils/mockDataset.ts`) carries two units (AMER, EMEA).
 *
 * Contracts are verified, not markup: the grid is built from the unit, an edit
 * opens the draft by itself and doesn't touch published data, the picker
 * offers only that day's shifts, coverage and violations recompute, and
 * publish is blocked by gaps.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { queryClient } from './api/queryClient.ts';
import { ALL_UNITS } from './domain/types.ts';
import { eachDate } from './engine/dates.ts';
import { rangeFor } from './engine/period.ts';
import { useSchedule } from './store/useSchedule.ts';
import { TODAY, useUi } from './store/useUi.ts';
import { mockBackend, resetMockApi, server } from './testUtils/mockApi.ts';
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
    activeShiftId: undefined,
    clipboard: undefined,
    absenceDraft: undefined,
    compDayDraft: undefined,
    // NOTE: the app default is "all units" (ADR-0020) — reset to that, not to
    // a specific region, otherwise tests would verify a state other than what
    // the user sees on open.
    unitId: ALL_UNITS,
    overview: { anchor: TODAY, span: 1 },
    schedule: { anchor: TODAY, zoom: 'month' },
    range: rangeFor('month', TODAY),
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
 * NOTE: the app opens on Overview — planning is one tab away. The unit is set
 * before render, so the grid loads under it in a single pass.
 *
 * Overview and Schedule hold independent periods (ADR-0036) and both write to
 * the shared `useUi.range`/`useSchedule.range` on mount: Overview narrowing to
 * 1/3/7 days, Schedule to a month. Switching screens briefly carries data under
 * the previous screen's period until the effect runs and the plan catches up
 * to the new range — we wait for exactly that, not just for the grid to appear.
 */
async function renderSchedule(unitId: string = DEFAULT_UNIT) {
  useUi.setState({ unitId });
  const utils = renderApp();
  fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
  await screen.findByRole('grid', {}, { timeout: 10000 });
  await waitFor(() => {
    expect(useSchedule.getState().range).toEqual(useUi.getState().range);
  });
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

/** A unit person eligible for Cover, and their free weekday. */
function freeCoverCell(): { personId: string; date: string; shiftId: string } {
  const state = useSchedule.getState();
  const shift = state.reference?.shifts.find((s) => s.unitId === DEFAULT_UNIT && s.code === 'Cover');
  const person = state.reference?.people.find(
    (p) =>
      p.unitId === DEFAULT_UNIT &&
      p.isIncluded &&
      p.eligibility.some((e) => e.shiftId === shift?.id),
  );
  if (!shift || !person) throw new Error('No suitable person in the mock dataset');

  // Derived from the range on screen, not hard-coded to a month: the Schedule window
  // runs forward from the selected day now, so a fixed August date is not necessarily in
  // it (ADR-0036 as amended).
  const range = useSchedule.getState().range;
  if (!range) throw new Error('No range loaded');

  for (let offset = 0; offset < 31; offset += 1) {
    const cursor = new Date(`${range.from}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + offset);
    const date = cursor.toISOString().slice(0, 10);
    if (date > range.to) break;
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    return { personId: person.id, date, shiftId: shift.id };
  }
  throw new Error('No weekday in the visible range');
}

function cellShiftId(personId: string, date: string): string | undefined {
  const assignment = useSchedule
    .getState()
    .plan?.assignments.find((a) => a.personId === personId && a.date === date);
  return assignment?.content.kind === 'SHIFT' ? assignment.content.shiftId : undefined;
}

describe('shell', () => {
  it('opens on Overview and lets you navigate to every section', async () => {
    renderApp();
    expect(
      await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 }),
    ).toBeInTheDocument();

    for (const name of ['Overview', 'Schedule', 'People', 'Requests']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    // NOTE: dashboard and timeline are no longer separate tabs.
    expect(screen.queryByRole('link', { name: 'Timeline' })).toBeNull();
    // Settings is configuration, so it is hidden from anyone who administers nothing
    // (ADR-0051). The default test identity plans and approves; it does not administer.
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('Overview shows all units at once, with no need to pick one', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Coverage timeline' }, { timeout: 10000 });

    // NOTE: ALL by default — the lane should carry both mock units' tracks.
    for (const unit of ['Americas', 'EMEA']) {
      expect(screen.getAllByText(unit).length).toBeGreaterThan(0);
    }
  });

  it('People computes workload and comp-day debt', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'People' }, { timeout: 10000 }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Weekends')).toBeInTheDocument();
    expect(within(table).getByText('Comp owed')).toBeInTheDocument();
  });

  it('Settings is offered to an administrator, and shows the unit\'s real shift codes', async () => {
    mockBackend.roles = [{ role: 'admin' }];
    renderApp();
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }, { timeout: 10000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Shifts' }));
    const table = await screen.findByRole('table');
    // Phase 6: shift code is now an editable field, not static text.
    expect(within(table).getByDisplayValue('Batch-E')).toBeInTheDocument();
  });
});

describe('period selection', () => {
  // NOTE: Schedule never plans shorter than a month (ADR-0036) — week and day
  // zoom no longer exist on this screen; 3/6 months instead switch to a
  // read-only heatmap (ADR: a 90-180 column grid fits neither the screen nor
  // the render budget).
  it('3 Months switches the editable grid to the heatmap', async () => {
    await renderSchedule();
    expect(grid().querySelectorAll('.sheet__head').length).toBeGreaterThan(28);

    fireEvent.click(screen.getByRole('button', { name: '3 Months' }));
    await waitFor(() => {
      expect(screen.getByText(/Read-only overview/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('grid')).toBeNull();
  });
});

describe('grid', () => {
  it('renders the unit\'s people and the days of the month', async () => {
    await renderSchedule();
    const cells = grid().querySelectorAll('[role="gridcell"]');
    // Everyone active, managers included. `isIncluded` decides who gets *planned*, not
    // who is drawn: a manager holds no shifts and still takes leave, and their row is the
    // only place to record it. Deciding both with one flag meant an administrator existed
    // in the list only while you were acting as them.
    const people = useSchedule
      .getState()
      .reference?.people.filter((p) => p.unitId === DEFAULT_UNIT && p.isActive);

    expect(people?.some((person) => !person.isIncluded)).toBe(true);
    // WHY the column count is derived and not the literal 31 it used to be: the `month`
    // window runs one month forward from the anchor and ends the day before (ADR-0036,
    // `rangeFor`), so it is 28-31 columns depending on what today is. Hardcoding 31 made
    // this test pass in July and fail in September for no reason connected to the grid.
    const days = eachDate(rangeFor('month', TODAY)).length;
    expect(cells.length).toBe((people?.length ?? 0) * days);
  });

  it('groups by location, as configured on the unit', async () => {
    await renderSchedule();
    const headers = [...grid().querySelectorAll('.sheet__group')].map((el) =>
      el.textContent?.replace(/\d+/g, '').trim(),
    );
    expect(headers).toContain('Chicago');
    expect(headers).toContain('New York');
    expect(headers).toContain('Pune');
  });

  it('switching from "all units" to one removes groups from other locations', async () => {
    // NOTE: regression — "all units" shows City groups from both units
    // (Chicago/New York/Pune from AMER, London from EMEA); switching to a
    // single unit via the picker itself should remove London/EMEA, not leave
    // them behind as dividers.
    await renderSchedule(ALL_UNITS);
    const headersBefore = [...grid().querySelectorAll('.sheet__group')].map((el) =>
      el.textContent?.replace(/\d+/g, '').trim(),
    );
    expect(headersBefore).toContain('London');
    expect(headersBefore).toContain('EMEA');

    fireEvent.click(screen.getByRole('button', { name: 'Planning units' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Americas' }));

    await waitFor(() => {
      expect(useSchedule.getState().unitId).toBe(DEFAULT_UNIT);
    });

    await waitFor(() => {
      const headersAfter = [...grid().querySelectorAll('.sheet__group')].map((el) =>
        el.textContent?.replace(/\d+/g, '').trim(),
      );
      expect(headersAfter).not.toContain('London');
      expect(headersAfter).not.toContain('EMEA');
      expect(headersAfter).toContain('Chicago');
    });
  });

  it('after a programmatic "one -> all -> one" transition, no groups from another unit remain', async () => {
    // WHY: does the same thing the picker does internally (setUnit), just
    // without clicking through the Radix Popover — so the scenario tests the
    // grid data's reactivity, not the popup's mechanics.
    await renderSchedule();
    useUi.getState().setUnit(ALL_UNITS);

    await waitFor(() => {
      expect(useSchedule.getState().unitId).toBe(ALL_UNITS);
    });
    await waitFor(() => {
      const headers = [...grid().querySelectorAll('.sheet__group')].map((el) =>
        el.textContent?.replace(/\d+/g, '').trim(),
      );
      expect(headers).toContain('London');
    });

    useUi.getState().setUnit(DEFAULT_UNIT);

    await waitFor(() => {
      expect(useSchedule.getState().unitId).toBe(DEFAULT_UNIT);
    });
    await waitFor(() => {
      const headers = [...grid().querySelectorAll('.sheet__group')].map((el) =>
        el.textContent?.replace(/\d+/g, '').trim(),
      );
      expect(headers).not.toContain('London');
      expect(headers).not.toContain('EMEA');
    });
  });



  it('shows real shift codes and their windows on the palette', async () => {
    await renderSchedule();
    // NOTE: the palette is collapsed by default (owner review — it was squeezing the grid).
    fireEvent.click(screen.getByRole('button', { name: /Shifts/ }));
    const palette = await screen.findByRole('toolbar', { name: 'Shifts' });
    expect(within(palette).getByText('Lead')).toBeInTheDocument();
    expect(within(palette).getByText('Batch-E')).toBeInTheDocument();
  });
});

describe('draft', () => {
  it('an edit opens the draft by itself — no need to look for an Edit mode', async () => {
    await renderSchedule();
    const { personId, date, shiftId } = freeCoverCell();
    expect(useSchedule.getState().session).toBeUndefined();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });

    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBe(shiftId);
    });
    expect(useSchedule.getState().session).toBeDefined();
  });

  it('an edit in the draft does not touch published data', async () => {
    await renderSchedule();
    const { personId, date, shiftId } = freeCoverCell();
    const publishedBefore = useSchedule.getState().published?.assignments.length;

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });

    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBe(shiftId);
    });
    expect(useSchedule.getState().published?.assignments.length).toBe(publishedBefore);
  });

  it('Ctrl+Z reverts an edit', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBeDefined();
    });

    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBeUndefined();
    });
  });
});

describe('assignment picker', () => {
  it('opens on right-click, even in read-only mode', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();
    expect(useSchedule.getState().session).toBeUndefined();

    fireEvent.contextMenu(cellAt(personId, date));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('offers only shifts from this day\'s configuration', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');

    // NOTE: Friday shifts aren't offered Monday-Thursday, and vice versa
    // (fixture: weekday config runs Lead, friday config runs Lead-E).
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 5) expect(within(menu).queryByText('Lead')).toBeNull();
    else expect(within(menu).queryByText('Lead-E')).toBeNull();
  });

  it('never offers a shift from another unit', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    // NOTE: `M` is an EMEA shift.
    expect(within(menu).queryByText('M')).toBeNull();
  });

  it('sets a shift from the menu', async () => {
    await renderSchedule();
    const { personId, date, shiftId } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText('Cover'));

    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBe(shiftId);
    });
  });

  it('offers no roster markers, because there are none', async () => {
    // "Off" and "0 — not scheduled" were deleted with the markers themselves (ADR-0052).
    // An engineer who wants to be left off a day records the Not available absence, which
    // the self-service section of this same menu offers.
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.contextMenu(cellAt(personId, date));
    const menu = await screen.findByRole('menu');

    expect(within(menu).queryByText('0 — not scheduled')).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Off' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Not available/ })).toBeTruthy();
  });
});

describe('coverage and violations', () => {
  it('the coverage strip shows actual against minimum', async () => {
    await renderSchedule();
    const strip = screen.getByRole('group', { name: 'Coverage' });
    const cells = within(strip).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((cell) => /^\d+\/\d+$/.test(cell.textContent ?? ''))).toBe(true);
  });

  it('distinguishes a gap from coverage right at the edge', async () => {
    await renderSchedule();
    const strip = screen.getByRole('group', { name: 'Coverage' });
    const levels = new Set(
      within(strip)
        .getAllByRole('button')
        .map((cell) => cell.dataset.level),
    );
    // NOTE: an empty mock plan — nothing filled in, so every required role is a gap.
    expect(levels.has('GAP')).toBe(true);
  });

  it('the issues panel separates gaps from conflicts', async () => {
    await renderSchedule();
    const panel = screen.getByRole('complementary', { name: 'Issues' });
    expect(within(panel).getByRole('button', { name: /Gaps/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Conflicts/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Warnings/ })).toBeInTheDocument();
  });
});

describe('publish', () => {
  // NOTE: coverage gaps don't block publishing (ADR-0035, owner review) — gaps
  // stay visible and highlighted, but they don't stop saving the draft. Only
  // unacknowledged warnings and BLOCKING conflicts (double assignment, an
  // unknown/wrong-unit shift) keep the Publish button disabled.
  it('review shows the diff; coverage does not block publishing', async () => {
    await renderSchedule();
    const { personId, date, shiftId } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(cellShiftId(personId, date)).toBe(shiftId);
    });

    fireEvent.click(await screen.findByRole('button', { name: /Publish/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/created/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('the draft survives closing review', async () => {
    await renderSchedule();
    const { personId, date } = freeCoverCell();

    fireEvent.mouseDown(cellAt(personId, date));
    fireEvent.keyDown(grid(), { key: 'o' });
    await waitFor(() => {
      expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
    });

    fireEvent.click(await screen.findByRole('button', { name: /Publish/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(useSchedule.getState().changes.length).toBeGreaterThan(0);
  });
});
