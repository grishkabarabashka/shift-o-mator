/**
 * Корень приложения: загрузка данных, маршруты, общая оболочка.
 *
 * Данные грузятся один раз на (единица × период) и раздаются всем экранам через
 * `usePlanningView`. Каждый экран, считающий покрытие заново, — это лишние
 * секунды на переключении вкладки и, что хуже, шанс показать на дашборде не то
 * же самое, что в сетке.
 */

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { TooltipProvider } from './ui/primitives.tsx';
import { useSchedule } from './store/useSchedule.ts';
import { TODAY, useUi } from './store/useUi.ts';
import { useNow } from './ui/useNow.ts';
import { AppShell } from './features/shell/AppShell.tsx';
import { usePlanningView } from './features/planning/usePlanningView.ts';
import { DayDrilldownPage } from './pages/DayDrilldownPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { PeoplePage } from './pages/PeoplePage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

export function App() {
  const unitId = useUi((s) => s.unitId);
  const range = useUi((s) => s.range);

  const load = useSchedule((s) => s.load);
  const status = useSchedule((s) => s.status);
  const error = useSchedule((s) => s.error);

  const view = usePlanningView(TODAY);
  const now = useNow();

  useEffect(() => {
    void load(unitId, range);
  }, [load, unitId, range]);

  return (
    <AuthProvider>
      <TooltipProvider>
        <BrowserRouter>
          <AppShell>
            {status === 'error' ? (
              <Placeholder title="Could not load the schedule" body={error ?? 'Unknown error'} />
            ) : !view.ready ? (
              <Placeholder title="Loading…" body="Reading the published plan." />
            ) : (
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<OverviewPage view={view} now={now} />} />
                <Route path="/schedule" element={<SchedulePage view={view} asOf={TODAY} />} />
                <Route path="/schedule/day/:date" element={<DayDrilldownPage view={view} now={now} />} />
                <Route path="/people" element={<PeoplePage view={view} asOf={TODAY} />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* Дашборд и таймлайн слились в Overview — старые ссылки живут. */}
                <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
                <Route path="/timeline" element={<Navigate to="/overview" replace />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            )}
          </AppShell>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  );
}

function Placeholder({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] text-muted">{body}</p>
      </div>
    </div>
  );
}
