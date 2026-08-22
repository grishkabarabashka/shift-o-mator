/**
 * @vitest-environment jsdom
 *
 * Phase 6 — Settings editing flows: the dirty bar appears on the first edit,
 * Save All round-trips through the mocked `/api/admin/*` endpoints and clears
 * it, Cancel reverts without ever calling the network.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { queryClient } from '../api/queryClient.ts';
import { ALL_UNITS } from '../domain/types.ts';
import { rangeFor } from '../engine/period.ts';
import { TODAY, useUi } from '../store/useUi.ts';
import { mockBackend, resetMockApi, server } from '../testUtils/mockApi.ts';

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
    issueFilter: 'ALL',
    absenceDraft: undefined,
    compDayDraft: undefined,
    unitId: ALL_UNITS,
    zoom: 'month',
    anchor: TODAY,
    range: rangeFor('month', TODAY),
    custom: false,
  });
});

async function openSettings() {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'Settings' }, { timeout: 10000 }));
  await screen.findByRole('table');
}

describe('Settings — editing', () => {
  it('editing a location name shows the dirty bar', async () => {
    await openSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Locations' }));
    const table = await screen.findByRole('table');

    const chicagoInput = within(table).getByDisplayValue('Chicago');
    fireEvent.change(chicagoInput, { target: { value: 'Chicago (renamed)' } });

    expect(await screen.findByText(/1 unsaved change/)).toBeInTheDocument();
  });

  it('Save all persists the edit and clears the dirty bar', async () => {
    await openSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Locations' }));
    const table = await screen.findByRole('table');

    const chicagoInput = within(table).getByDisplayValue('Chicago');
    fireEvent.change(chicagoInput, { target: { value: 'Chicago (renamed)' } });
    await screen.findByText(/1 unsaved change/);

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => {
      expect(screen.queryByText(/unsaved change/)).toBeNull();
    });
    expect(mockBackend.data.locations.find((l) => l.id === 'loc-chi')?.name).toBe('Chicago (renamed)');
  });

  it('Cancel reverts the edit without touching the server', async () => {
    await openSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Locations' }));
    const table = await screen.findByRole('table');

    const chicagoInput = within(table).getByDisplayValue('Chicago');
    fireEvent.change(chicagoInput, { target: { value: 'Chicago (renamed)' } });
    await screen.findByText(/1 unsaved change/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText(/unsaved change/)).toBeNull();
    });
    expect(within(table).getByDisplayValue('Chicago')).toBeInTheDocument();
    expect(mockBackend.data.locations.find((l) => l.id === 'loc-chi')?.name).toBe('Chicago');
  });

  it('day-configuration versions are create-only — no edit action beyond a new version', async () => {
    await openSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Day configurations' }));
    expect(await screen.findByRole('button', { name: '+ New version' })).toBeInTheDocument();
    // No PUT-style inline inputs on the version cards themselves.
    expect(screen.queryByDisplayValue('weekday')).toBeNull();
  });
});
