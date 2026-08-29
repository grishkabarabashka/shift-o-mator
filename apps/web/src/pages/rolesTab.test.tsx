/**
 * @vitest-environment jsdom
 *
 * Granting roles from Settings (ADR-0051).
 *
 * The screen exists because roles are scoped to planning units, which are this product's
 * own concept: an identity provider has no idea what `unit-emea` is, so there has to be
 * somewhere in the app to say "she approves EMEA's leave".
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
    unitId: ALL_UNITS,
    overview: { anchor: TODAY, span: 1 },
    schedule: { anchor: TODAY, zoom: 'month' },
    range: rangeFor('month', TODAY),
  });
});

async function openRolesTab(roles: readonly { role: string; unitId?: string }[]) {
  mockBackend.roles = roles;
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'Settings' }, { timeout: 10000 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Roles' }, { timeout: 10000 }));
  return screen.findByRole('table', {}, { timeout: 10000 });
}

function checkboxFor(table: HTMLElement, role: string): HTMLInputElement {
  const box = within(table)
    .getAllByRole('checkbox')
    .find((input) => (input.getAttribute('aria-label') ?? '').startsWith(`${role} for `));
  if (!box) throw new Error(`No ${role} checkbox in the table`);
  return box as HTMLInputElement;
}

describe('an administrator of a unit', () => {
  it('grants a role, and it is scoped to the unit on screen', async () => {
    const table = await openRolesTab([{ role: 'admin' }]);

    fireEvent.click(checkboxFor(table, 'Approver'));

    await waitFor(() => expect(mockBackend.roleAssignments).toHaveLength(1));
    const grant = mockBackend.roleAssignments[0]!;
    expect(grant.role).toBe('approver');
    // The first unit tab is selected on mount, so the grant belongs to it — not to
    // "everywhere", which is the mistake a global default would invite.
    expect(grant.unitId).not.toBeNull();
  });

  it('revokes by unticking, because a grant has no middle state', async () => {
    const table = await openRolesTab([{ role: 'admin' }]);

    fireEvent.click(checkboxFor(table, 'Planner'));
    await waitFor(() => expect(mockBackend.roleAssignments).toHaveLength(1));

    fireEvent.click(checkboxFor(table, 'Planner'));
    await waitFor(() => expect(mockBackend.roleAssignments).toHaveLength(0));
  });

  it('offers no Viewer column, because everyone signed in already has it', async () => {
    const table = await openRolesTab([{ role: 'admin' }]);

    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Planner');
    expect(headers).toContain('Approver');
    expect(headers).toContain('Admin');
    expect(headers).not.toContain('Viewer');
  });
});

describe('an administrator of a different unit', () => {
  it('sees the grants but cannot change them', async () => {
    // Read-only rather than hidden: "who approves my leave" is a fair question for the
    // person waiting on an answer. Grants are scoped, so administering EMEA says nothing
    // about AMER — which is the tab that opens first.
    const table = await openRolesTab([{ role: 'admin', unitId: 'unit-emea' }]);

    expect(checkboxFor(table, 'Approver').disabled).toBe(true);
    expect(screen.getByText(/do not administer this unit/i)).toBeTruthy();
  });
});
