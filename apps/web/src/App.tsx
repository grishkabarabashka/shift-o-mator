/**
 * NOTE: application root — data loading, routes, the shared shell.
 *
 * Data loads once per (unit × period) and is handed to every screen through
 * `usePlanningView`. Any screen that recomputes coverage on its own costs extra
 * seconds on tab switch and, worse, risks showing something on the dashboard
 * that disagrees with the grid.
 */

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { EntraGate } from './auth/EntraGate.tsx';
import { TooltipProvider } from './ui/primitives.tsx';
import { useSchedule } from './store/useSchedule.ts';
import { TODAY, useUi } from './store/useUi.ts';
import { useNow } from './ui/useNow.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { AppShell } from './features/shell/AppShell.tsx';
import { usePlanningView } from './features/planning/usePlanningView.ts';
import { DayDrilldownPage } from './pages/DayDrilldownPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { PeoplePage } from './pages/PeoplePage.tsx';
import { MyCalendarPage } from './pages/MyCalendarPage.tsx';
import { RequestsPage } from './pages/RequestsPage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

export function App() {
  const unitId = useUi((s) => s.unitId);
  const range = useUi((s) => s.range);

  const load = useSchedule((s) => s.load);
  const status = useSchedule((s) => s.status);
  const error = useSchedule((s) => s.error);
  // WHY identity is a dependency: what the server returns is filtered by who is asking —
  // the inbox, which requests are decidable, what the grid lets you touch. Without this,
  // switching identity left every screen showing the previous person's answer until
  // something else happened to change the unit or the period.
  const currentUserId = useSchedule((s) => s.currentUserId);

  const view = usePlanningView(TODAY);
  const now = useNow();

  useEffect(() => {
    void load(unitId, range);
  }, [load, unitId, range, currentUserId]);

  return (
    // Outside AuthProvider: `/api/auth/me` must not be called before there is a token to
    // send, or it comes back 401 and the identity resolves to nothing (ADR-0058).
    // In stub mode the gate is transparent and this nesting costs nothing.
    <EntraGate>
    <AuthProvider>
      <IdentityBridge />
      <UnsavedWorkGuard />
      <TooltipProvider>
        <BrowserRouter>
          <AppShell>
            {/* Inside the shell, so a screen that throws leaves the header and the tabs
                usable — one broken screen you can navigate away from, rather than a white
                page and a lost session. */}
            <ErrorBoundary title="This screen could not be shown">
              {status === 'error' ? (
              <Placeholder
                title="Could not load the schedule"
                body={error ?? 'Unknown error'}
                // WHY a button and not just the message: this was a dead end. The load is a
                // store action nothing re-invoked on demand, so the only way out of a
                // dropped connection or a restarting API was to reload the page — and
                // nothing on screen said so.
                action={{ label: 'Try again', onClick: () => void load(unitId, range) }}
              />
            ) : !view.ready ? (
              <Placeholder title="Loading…" body="Reading the published plan." />
            ) : (
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<OverviewPage view={view} now={now} />} />
                <Route path="/schedule" element={<SchedulePage view={view} asOf={TODAY} />} />
                <Route path="/schedule/day/:date" element={<DayDrilldownPage view={view} now={now} />} />
                <Route path="/people" element={<PeoplePage view={view} asOf={TODAY} />} />
                <Route path="/me" element={<MyCalendarPage />} />
                <Route path="/requests" element={<RequestsPage view={view} />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* NOTE: dashboard and timeline merged into Overview — old links still resolve. */}
                <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
                <Route path="/timeline" element={<Navigate to="/overview" replace />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
              )}
            </ErrorBoundary>
          </AppShell>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
    </EntraGate>
  );
}

/**
 * NOTE: Copies the server-resolved identity into the Zustand store (ADR-0039).
 *
 * WHY a component: the store is outside React, and the identity arrives asynchronously
 * from `GET /api/auth/me`. Before this, `useSchedule.load()` guessed the current user
 * from reference data, and that guess ended up as `createdBy`/`updatedBy` on every edit
 * — a different answer from the one the server wrote into the audit trail.
 */
function IdentityBridge() {
  const identity = useAuth();
  const setCurrentUser = useSchedule((s) => s.setCurrentUser);

  useEffect(() => {
    setCurrentUser(identity.resolved ? identity.personId : undefined);
  }, [setCurrentUser, identity.resolved, identity.personId]);

  return null;
}

/**
 * NOTE: Refuses to close the tab while edits are still on their way to the server.
 *
 * Draft changes are debounced by ~400ms and retried on failure, so there is a real
 * window in which the grid shows an edit the server has never seen. Closing the tab in
 * that window loses it silently.
 */
function UnsavedWorkGuard() {
  const pendingSync = useSchedule((s) => s.pendingSync);
  const syncError = useSchedule((s) => s.syncError);
  const atRisk = pendingSync || syncError !== undefined;

  useEffect(() => {
    if (!atRisk) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers ignore custom text now and show their own wording; assigning
      // returnValue is still what triggers the prompt at all.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [atRisk]);

  return null;
}

function Placeholder({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-base text-muted">{body}</p>
        {action ? (
          <button type="button" className="btn btn--sm btn--primary mt-3" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
