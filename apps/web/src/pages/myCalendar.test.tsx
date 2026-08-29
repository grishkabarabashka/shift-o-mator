/**
 * @vitest-environment jsdom
 *
 * My calendar: one person's own months, and the actions on a day of them.
 *
 * The contract worth testing is that this is not a second product. It draws what the grid
 * draws, from the same projections, and asking for a day off from here goes down the same
 * route it does from a cell — a screen that quietly grew its own rules about what needs
 * approving would be the failure the whole two-flows design exists to prevent.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { queryClient } from '../api/queryClient.ts';
import { useSchedule } from '../store/useSchedule.ts';
import { mockBackend, resetMockApi, server } from '../testUtils/mockApi.ts';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  resetMockApi();
  queryClient.clear();
  window.history.pushState({}, '', '/');
});

async function openCalendar() {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'My calendar' }, { timeout: 10000 }));
  // The heading, not the nav link that shares its words.
  return screen.findByRole('heading', { name: 'My calendar' }, { timeout: 10000 });
}

/** The day box for a date, found by the number it prints. */
function dayBox(date: string): HTMLElement {
  const number = date.slice(8).replace(/^0/, '');
  const found = screen
    .getAllByRole('gridcell')
    .find((cell) => cell.textContent?.startsWith(number));
  if (!found) throw new Error(`No day box for ${date}`);
  return found;
}

/** A weekday inside the month the calendar opens on. */
function dayThisMonth(offset: number): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1 + offset));
  return day.toISOString().slice(0, 10);
}

describe('my calendar', () => {
  it('shows the months as a calendar, this month included', async () => {
    await openCalendar();

    const heading = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    expect(await screen.findByRole('grid', { name: heading }, { timeout: 10000 })).toBeTruthy();
  });

  it('records a day from the calendar and draws it there', async () => {
    // The round trip the screen exists for, and the half that is easy to get wrong: the
    // calendar reads its own long window through its own query, so a write made from here
    // has to reach it. Without that it sat unchanged until a reload — the same shape of
    // defect as an approval never reaching the grid.
    await openCalendar();
    await waitFor(() => expect(useSchedule.getState().currentUserId).toBeTruthy());
    const me = useSchedule.getState().currentUserId;

    const target = dayBox(dayThisMonth(9));
    fireEvent.contextMenu(target);
    const menu = await screen.findByRole('menu', { name: 'Day' }, { timeout: 10000 });

    // Travelling is written straight in — no approval — so the day changes immediately.
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Travelling/ }));

    await waitFor(() =>
      expect(mockBackend.data.presence.some((p) => p.personId === me)).toBe(true),
    );
    await waitFor(() =>
      expect(dayBox(dayThisMonth(9)).textContent).toContain('Travelling'),
    );
  });

  it('asks for time off through the same menu the grid uses', async () => {
    await openCalendar();

    fireEvent.contextMenu(dayBox(dayThisMonth(9)));
    const menu = await screen.findByRole('menu', { name: 'Day' }, { timeout: 10000 });

    // The self-service menu, unchanged: the same "needs approval" note the cell picker
    // shows, from the same presence types.
    expect(within(menu).getByText(/Where I/)).toBeTruthy();
    expect(within(menu).getAllByText('needs approval').length).toBeGreaterThan(0);
  });

  it('offers the subscription address and a way to revoke it', async () => {
    await openCalendar();

    expect(await screen.findByRole('button', { name: 'Copy address' }, { timeout: 10000 })).toBeTruthy();
    // A URL is a credential, and the only defence against a leaked one is rotating it.
    expect(screen.getByRole('button', { name: 'Reset the address' })).toBeTruthy();
  });
});
