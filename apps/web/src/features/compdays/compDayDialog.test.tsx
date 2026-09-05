/**
 * @vitest-environment jsdom
 *
 * Placing an earned comp day (ADR-0052).
 *
 * The accrual exists from the moment the weekend shift was published; what happens in the
 * dialog is the person choosing which day they actually take, which an approver signs off.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { datasetNow } from '../../store/useDataset.ts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { queryClient } from '../../api/queryClient.ts';
import { ALL_UNITS } from '../../domain/types.ts';
import { rangeFor } from '../../engine/period.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { mockBackend, resetMockApi, server } from '../../testUtils/mockApi.ts';
import { DEFAULT_UNIT } from '../../testUtils/mockDataset.ts';

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
    unitId: ALL_UNITS,
    compDayDraft: undefined,
    overview: { anchor: TODAY, span: 1 },
    schedule: { anchor: TODAY, zoom: 'month' },
    range: rangeFor('month', TODAY),
  });
});

async function openDialogForFirstCompDay() {
  useUi.setState({ unitId: DEFAULT_UNIT });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
  await screen.findByRole('grid', {}, { timeout: 10000 });

  const entry = await waitFor(() => {
    const first = datasetNow().plan?.compDays[0];
    if (!first) throw new Error('No comp day in the mock plan');
    return first;
  });

  // Opened through the store rather than the picker: the dialog is what is under test,
  // and reaching it through the grid would be testing the menu instead.
  useUi.getState().openCompDayDialog(entry);
  return entry;
}

describe('the comp day dialog', () => {
  it('offers the proposed day straight away, without nudging the date first', async () => {
    // The defect: the field was pre-filled with the proposed date and the button was
    // disabled whenever the field *equalled* that date — so it was dead on arrival, and
    // taking the day the system proposed was the one thing you could not do.
    await openDialogForFirstCompDay();

    const ask = await screen.findByRole('button', { name: /Ask for this day|Ask on/ });
    expect(ask).not.toBeDisabled();
  });

  it('asking raises a request rather than moving the day', async () => {
    const entry = await openDialogForFirstCompDay();

    fireEvent.click(await screen.findByRole('button', { name: /Ask for this day|Ask on/ }));

    await waitFor(() => expect(mockBackend.requests.length).toBeGreaterThan(0));
    const raised = mockBackend.requests.at(-1)!;
    expect(raised.subjectPersonId).toBe(entry.personId);
    // Nothing is settled until somebody approves.
    expect(raised.state).toBe('SUBMITTED');
  });
});
