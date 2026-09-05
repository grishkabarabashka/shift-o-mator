/**
 * @vitest-environment jsdom
 *
 * One grid, editability by role (ADR-0050).
 *
 * The defect this covers was live: nothing gated the UI, so a Viewer was offered the
 * palette and the shift picker, and the first edit 403'd into an unhandled rejection —
 * the click did nothing and said nothing.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { datasetNow } from '../../store/useDataset.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { queryClient } from '../../api/queryClient.ts';
import { setDebugIdentity } from '../../api/client.ts';
import { ALL_UNITS } from '../../domain/types.ts';
import { rangeFor } from '../../engine/period.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { mockBackend, resetMockApi, server } from '../../testUtils/mockApi.ts';
import { DEFAULT_UNIT } from '../../testUtils/mockDataset.ts';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setDebugIdentity(undefined);
});
afterAll(() => server.close());

beforeEach(() => {
  resetMockApi();
  queryClient.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  useUi.setState({
    unitId: ALL_UNITS,
    overview: { anchor: TODAY, span: 1 },
    schedule: { anchor: TODAY, zoom: 'month' },
    range: rangeFor('month', TODAY),
  });
});

async function renderScheduleAs(role: 'Viewer' | 'Planner' | 'Approver' | 'Admin') {
  // Roles are a set (ADR-0051); a test that names one means "only that one", and Viewer
  // is what everyone signed in holds anyway.
  mockBackend.roles = role === 'Viewer' ? [] : [{ role: role.toLowerCase() }];
  useUi.setState({ unitId: DEFAULT_UNIT });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
  await screen.findByRole('grid', {}, { timeout: 10000 });
  await waitFor(() => {
    expect(useSchedule.getState().range).toEqual(useUi.getState().range);
  });
}

/** A cell belonging to somebody who is not the signed-in person. */
function someoneElsesCell(): HTMLElement {
  const grid = screen.getByRole('grid');
  const me = mockBackend.currentPersonId;
  const cell = grid.querySelector<HTMLElement>(`[data-cell]:not([data-person="${me}"])`);
  if (!cell) throw new Error('No other-person cell in the grid');
  return cell;
}

describe('a planner', () => {
  it('is offered the planning actions', async () => {
    await renderScheduleAs('Planner');

    expect(screen.getByRole('button', { name: 'Generate…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import…' })).toBeTruthy();
  });

  it('gets shifts in the picker', async () => {
    await renderScheduleAs('Planner');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    expect(menu.textContent).toContain('Shifts');
  });
});

describe('a viewer', () => {
  it('still sees the grid — reading the rota is the product s first purpose', async () => {
    await renderScheduleAs('Viewer');

    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByRole('grid').querySelectorAll('[data-cell]').length).toBeGreaterThan(0);
  });

  it('is not offered planning actions', async () => {
    await renderScheduleAs('Viewer');

    expect(screen.queryByRole('button', { name: 'Generate…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import…' })).toBeNull();
  });

  it('gets no shift list in the picker', async () => {
    // Offering shifts a viewer cannot assign is the defect: the click used to open a
    // draft, 403, and silently do nothing.
    await renderScheduleAs('Viewer');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    expect(menu.textContent).not.toContain('Shifts');
  });

  it('is told to use the request path instead', async () => {
    await renderScheduleAs('Viewer');

    expect(
      screen.getByText(/Right-click your own row to ask for leave/),
    ).toBeTruthy();
  });

  it('always has their own row, even when they are not planned', async () => {
    // Managers are `isIncluded: false` and hold no shifts, but they still work somewhere
    // and still take leave — excluding them left them no way to record either (ADR-0050).
    await renderScheduleAs('Viewer');
    const me = mockBackend.currentPersonId;

    const own = screen
      .getByRole('grid')
      .querySelector<HTMLElement>(`[data-cell][data-person="${me}"]`);

    expect(own).not.toBeNull();
    expect(own?.getAttribute('data-self')).toBe('true');
  });

  it('gets one-click presence and time-off actions on their own row', async () => {
    await renderScheduleAs('Viewer');
    const me = mockBackend.currentPersonId;
    const own = screen
      .getByRole('grid')
      .querySelector<HTMLElement>(`[data-cell][data-person="${me}"]`);

    fireEvent.contextMenu(own!);
    const menu = await screen.findByRole('menu', { name: 'Assignment' });

    // One click each, not a menu entry that opens a modal.
    expect(within(menu).getByRole('menuitem', { name: /Remote/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'In the office' })).toBeTruthy();
    // And the half-day choice is a toggle, not a dropdown inside a dialog.
    expect(within(menu).getByRole('button', { name: 'AM' })).toBeTruthy();
  });

  it('can open the history of any cell', async () => {
    // Audit is readable by everyone: "who changed this, and when did the request come
    // in" is not a privileged question (ADR-0050).
    await renderScheduleAs('Viewer');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    expect(menu.textContent).toContain('History');
  });
});

describe('acting on somebody else s row', () => {
  it('files the request against them, not against the planner', async () => {
    // The defect was live and silent: the menu sent no subject, so the server filed the
    // request against the caller. A planner asking for remote on an engineer s row got
    // remote for themselves, on a row they were not even looking at.
    await renderScheduleAs('Planner');
    const cell = someoneElsesCell();
    const subject = cell.getAttribute('data-person');

    fireEvent.contextMenu(cell);
    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Remote/ }));

    await waitFor(() => expect(mockBackend.requests.length).toBeGreaterThan(0));
    expect(mockBackend.requests.at(-1)?.subjectPersonId).toBe(subject);
    expect(subject).not.toBe(mockBackend.currentPersonId);
  });

  it('records office presence directly, because no approval is involved', async () => {
    // The counterpart: an office day is a statement of fact, so a planner writes it.
    await renderScheduleAs('Planner');
    const cell = someoneElsesCell();
    const subject = cell.getAttribute('data-person');

    fireEvent.contextMenu(cell);
    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'In the office' }));

    await waitFor(() => expect(mockBackend.data.presence.length).toBeGreaterThan(0));
    expect(mockBackend.data.presence.at(-1)?.personId).toBe(subject);
  });

  it('names them in the menu, so the row being acted on is never in doubt', async () => {
    await renderScheduleAs('Planner');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    expect(menu.textContent).not.toContain('Where I');
  });
});

describe('leave on somebody else s row', () => {
  it('is a request even for a planner, because approval is a property of the leave', async () => {
    // A planner owns the rota, not other people s time off (ADR-0051). Before this the
    // planner wrote the absence straight in, which is the approval step not happening.
    await renderScheduleAs('Planner');
    const cell = someoneElsesCell();
    const subject = cell.getAttribute('data-person');

    fireEvent.contextMenu(cell);
    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Annual leave/ }));

    await waitFor(() => expect(mockBackend.requests.length).toBeGreaterThan(0));
    expect(mockBackend.requests.at(-1)?.subjectPersonId).toBe(subject);
    // And no draft was opened: nothing about the rota changed.
    expect(useSchedule.getState().session).toBeUndefined();
  });

  it('is labelled as needing approval, whoever is looking', async () => {
    await renderScheduleAs('Planner');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    const leave = within(menu).getByRole('menuitem', { name: /Annual leave/ });

    expect(leave.textContent).toContain('needs approval');
  });
});

describe('recording an absence that needs no approval', () => {
  it('writes straight through, opening no draft', async () => {
    // Drafts publish the rota; time off is not part of that decision (ADR-0052). This
    // used to be staged in whatever draft was open, so it went nowhere until an unrelated
    // planner published, and a non-planner got a 403 from an endpoint they should never
    // have been calling.
    await renderScheduleAs('Planner');
    const cell = someoneElsesCell();
    const subject = cell.getAttribute('data-person');
    const before = datasetNow().plan?.absences.length ?? 0;

    fireEvent.contextMenu(cell);
    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Not available/ }));

    await waitFor(() =>
      expect(datasetNow().plan?.absences.length).toBe(before + 1),
    );
    expect(datasetNow().plan?.absences.at(-1)?.personId).toBe(subject);
    expect(useSchedule.getState().session).toBeUndefined();
  });

  it('sick leave is a request, not a direct write', async () => {
    // Reversed from the seed's earlier reading. "You are already off, approval would be
    // theatre" described the notification, not the record: a sick day still has to be
    // accepted before it stands as the reason a shift went uncovered.
    await renderScheduleAs('Planner');
    fireEvent.contextMenu(someoneElsesCell());

    const menu = await screen.findByRole('menu', { name: 'Assignment' });
    const sick = within(menu).getByRole('menuitem', { name: /Sick leave/ });

    expect(sick.textContent).toContain('needs approval');
    fireEvent.click(sick);
    await waitFor(() => expect(mockBackend.requests.length).toBeGreaterThan(0));
  });
});
