/**
 * @vitest-environment jsdom
 *
 * Self-service end to end through the UI (ADR-0047, ADR-0046, ADR-0043): raise a
 * request, approve it, and see the presence it created land on the schedule.
 *
 * The contract under test is that the three pieces are actually connected — a request
 * that is approved but whose result never reaches the grid is the failure this whole
 * feature exists to avoid, and it is invisible to any test that stops at "state is
 * applied".
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { datasetNow } from '../../store/useDataset.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { queryClient } from '../../api/queryClient.ts';
import { ALL_UNITS } from '../../domain/types.ts';
import { rangeFor } from '../../engine/period.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { TODAY, useUi } from '../../store/useUi.ts';
import { mockBackend, resetMockApi, server } from '../../testUtils/mockApi.ts';
import { MOCK_REQUEST_TYPES } from '../../testUtils/mockSelfService.ts';
import { apiPost } from '../../api/client.ts';

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
    overview: { anchor: TODAY, span: 1 },
    schedule: { anchor: TODAY, zoom: 'month' },
    range: rangeFor('month', TODAY),
  });
});

async function renderRequests() {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'Requests' }, { timeout: 10000 }));
  await screen.findByText('Ask for something', {}, { timeout: 10000 });
  return utils;
}

function section(heading: string): HTMLElement {
  const element = screen.getByText(heading).closest('section');
  if (!element) throw new Error(`No section headed "${heading}"`);
  return element as HTMLElement;
}

/**
 * A date inside the month the Schedule screen shows.
 *
 * NOTE: anchored on the schedule month, not on `useUi.range`. Overview and Schedule hold
 * independent periods (ADR-0036), so reading the live range while sitting on Requests
 * picks up whichever screen was last mounted — which produced a date outside the month
 * the grid then loaded, and a presence record that was correctly created and correctly
 * not shown.
 */
function dateInRange(): string {
  const day = new Date(`${rangeFor('month', TODAY).from}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 9);
  return day.toISOString().slice(0, 10);
}

/**
 * NOTE: Radix's Select is a button plus a portalled listbox, not a native `<select>`,
 * so it is driven by keyboard here — which is also the interaction a11y depends on, and
 * therefore worth exercising rather than bypassing.
 */
async function chooseOption(ariaLabel: string, optionLabel: string) {
  const trigger = screen.getByLabelText(ariaLabel);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const option = await screen.findByRole('option', { name: optionLabel });
  fireEvent.click(option);
  await waitFor(() => expect(trigger).toHaveTextContent(optionLabel));
}

async function raiseRemoteRequest(date: string) {
  await chooseOption('Request type', 'Work remotely');
  const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
  fireEvent.change(dateInputs[0]!, { target: { value: date } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(mockBackend.requests).toHaveLength(1));
}

describe('raising a request', () => {
  it('sends it and shows it as awaiting approval', async () => {
    await renderRequests();
    const date = dateInRange();

    await raiseRemoteRequest(date);

    const request = mockBackend.requests[0]!;
    expect(request.typeId).toBe('rt-remote');
    expect(request.from).toBe(date);
    // `to` was left blank: a one-day ask is the common case and must not require
    // entering the same date twice.
    expect(request.to).toBe(date);
    expect(request.state).toBe('SUBMITTED');
  });

  it('appears in both "your requests" and the approver inbox', async () => {
    await renderRequests();
    await raiseRemoteRequest(dateInRange());

    // Two lists, one screen: the requester's record and the approver's queue. Scoped to
    // each section rather than counted across the page, because the type label also
    // appears in the form's own picker.
    await waitFor(() => {
      expect(within(section('Your requests')).getByText('Work remotely')).toBeTruthy();
    });
    await waitFor(() => {
      expect(within(section('Waiting on you')).getByText('Work remotely')).toBeTruthy();
    });
    expect(within(section('Waiting on you')).getByRole('button', { name: 'Approve' })).toBeTruthy();
  });
});

describe('approving a request', () => {
  it('creates the presence record the request asked for', async () => {
    await renderRequests();
    const date = dateInRange();
    await raiseRemoteRequest(date);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve' }))[0]!);

    await waitFor(() => {
      expect(mockBackend.data.presence).toHaveLength(1);
    });
    const presence = mockBackend.data.presence[0]!;
    expect(presence.typeId).toBe('pt-remote');
    expect(presence.from).toBe(date);
    expect(presence.requestId).toBe(mockBackend.requests[0]!.id);
  });

  it('the approved presence reaches the schedule, not just the request list', async () => {
    // The point of the whole feature: an approval that only flips a request's state has
    // moved the spreadsheet, not replaced it. What has to happen is that the roster —
    // the thing planners actually look at — knows about it.
    //
    // Asserted on the loaded plan rather than on a grid cell because the stub identity
    // is a manager: managers are `isIncluded: false` and deliberately have no row in the
    // grid (ADR-0038). Cell rendering is covered by `engine/presence.test.ts` and by the
    // planner-entered case below.
    await renderRequests();
    const date = dateInRange();
    await raiseRemoteRequest(date);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve' }))[0]!);
    await waitFor(() => expect(mockBackend.data.presence).toHaveLength(1));

    fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }));
    await screen.findByRole('grid', {}, { timeout: 10000 });

    await waitFor(
      () => {
        const presence = datasetNow().plan?.presence ?? [];
        expect(presence.some((p) => p.typeId === 'pt-remote' && p.from === date)).toBe(true);
      },
      { timeout: 10000 },
    );
  });

  it('renders a presence mark in the grid cell of a planned person', async () => {
    // The rendering half of the same story, on someone who actually has a row.
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
    await screen.findByRole('grid', {}, { timeout: 10000 });

    const date = dateInRange();
    const person = datasetNow().reference?.people.find((p) => p.isIncluded && p.defaultPresenceTypeId === 'pt-office');
    expect(person).toBeDefined();

    await useSchedule.getState().savePresence({
      personId: person!.id,
      typeId: 'pt-remote',
      from: date,
      to: date,
    });

    await waitFor(() => {
      const cell = screen
        .getByRole('grid')
        .querySelector(`[data-person="${person!.id}"][data-date="${date}"]`);
      // Remote is a departure from the office baseline, so the cell carries a mark.
      expect(cell?.querySelector('.cell__band-part')?.textContent).toBe('R');
    });
  });

  /**
   * The defect this pins down: approving from the **grid** made the dashed pending band
   * disappear and never drew the day that was granted. The cell went empty and stayed
   * empty until the tab was reloaded.
   *
   * The cause was that the store snapshotted the schedule query once, at `load()`, so a
   * write the *server* made on our behalf — which every approval is — had no way in.
   * Invalidating the query has to be enough on its own, from anywhere, and this asserts
   * exactly that: nothing here navigates, reloads, or calls a store action.
   */
  it('an approval reaches a grid that is already on screen, with no reload', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Schedule' }, { timeout: 10000 }));
    await screen.findByRole('grid', {}, { timeout: 10000 });

    const date = dateInRange();
    const person = datasetNow().reference?.people.find((p) => p.isIncluded && p.defaultPresenceTypeId === 'pt-office');
    expect(person).toBeDefined();

    const type = MOCK_REQUEST_TYPES.find((t) => t.code === 'REMOTE')!;
    const created = await apiPost<{ id: string }>('/api/requests', {
      typeId: type.id,
      subjectPersonId: person!.id,
      from: date,
      to: date,
      portion: 'full',
    });
    await apiPost(`/api/requests/${created.id}/decide`, { decision: 'APPROVE', comment: null });
    await queryClient.invalidateQueries({ queryKey: ['schedule'] });

    await waitFor(() => {
      const cell = screen
        .getByRole('grid')
        .querySelector(`[data-person="${person!.id}"][data-date="${date}"]`);
      expect(cell?.querySelector('.cell__band-part')?.textContent).toBe('R');
    });
  });

  it('declining creates nothing', async () => {
    await renderRequests();
    await raiseRemoteRequest(dateInRange());

    fireEvent.click((await screen.findAllByRole('button', { name: 'Decline' }))[0]!);

    await waitFor(() => expect(mockBackend.requests[0]!.state).toBe('REJECTED'));
    expect(mockBackend.data.presence).toHaveLength(0);
  });
});

describe('withdrawing', () => {
  it('removes what an approved request created', async () => {
    await renderRequests();
    await raiseRemoteRequest(dateInRange());
    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve' }))[0]!);
    await waitFor(() => expect(mockBackend.data.presence).toHaveLength(1));

    // WHY the click is inside waitFor: the approval's refetch re-renders this list as it
    // lands, so a button found a moment earlier can already be a detached node — clicking
    // it reaches nothing and the test fails describing the wrong thing. Retrying until
    // the outcome is true clicks whichever button is actually on screen.
    await waitFor(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw' })[0]!);
      expect(mockBackend.requests[0]!.state).toBe('CANCELLED');
    });

    // Leaving the presence behind would show the roster something the person
    // explicitly took back.
    await waitFor(() => expect(mockBackend.data.presence).toHaveLength(0));
    expect(mockBackend.requests[0]!.state).toBe('CANCELLED');
  });
});

describe('the notification bell', () => {
  it('counts unread items and clears them on demand', async () => {
    await renderRequests();
    await raiseRemoteRequest(dateInRange());

    const bell = await screen.findByRole('button', { name: /Notifications, \d+ unread/ });
    fireEvent.click(bell);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    });
  });
});

describe('the plan itself is untouched by a request', () => {
  it('raising one opens no draft', async () => {
    // Presence and requests deliberately bypass the draft (ADR-0043): a draft opened by
    // an employee asking to work from home would sit in a planner's way for no reason.
    await renderRequests();
    await raiseRemoteRequest(dateInRange());

    expect(useSchedule.getState().session).toBeUndefined();
    expect(useSchedule.getState().changes).toHaveLength(0);
  });
});
