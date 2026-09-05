import { useState } from 'react';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { useCanLoadDemoData, useLoadDemoData, useResetSystem } from '../../api/setup.ts';
import { useAddAllowedCalendarHost, useAllowedCalendarHosts, useRemoveAllowedCalendarHost } from '../../api/allowedCalendarHosts.ts';
import { ApiError } from '../../api/client.ts';
import { toast } from '../../ui/toasts.ts';

/**
 * The two operations that replaced `Seed:IncludeDemoData`, `--seed-demo` and
 * `Auth:BootstrapAdminEmail` (ADR-0059): loading the demo fixture into an untouched Bare
 * system, and resetting to the migrated-but-empty state the setup wizard runs against.
 * Global-Admin only — configuration belonging to no unit is a global grant's business.
 */
export function MaintenanceTab() {
  const caps = useCapabilities();
  const canLoad = useCanLoadDemoData();
  const loadDemo = useLoadDemoData();
  const reset = useResetSystem();
  const [confirmText, setConfirmText] = useState('');

  if (!caps.canAdministerGlobally) {
    return (
      <p className="p-4 text-[12px] text-warn">
        Maintenance means the same thing for the whole system, so it needs a global
        administrator. This is read-only for you.
      </p>
    );
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-6 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Load demo data</h3>
        <p className="text-[12px] text-muted">
          Replaces this system's single location, unit and administrator with the fixture
          entire: four planning units, a trimmed roster, shifts and a sample rota. Only
          offered while nobody has added a person or scheduled anything yet — merging the
          fixture's fixed ids into a system somebody has already typed real data into
          would produce a roster nobody can reason about.
        </p>
        <button
          type="button"
          className="btn btn--sm self-start"
          disabled={!canLoad.data?.available || loadDemo.isPending}
          onClick={() =>
            loadDemo.mutate(undefined, {
              onSuccess: () => toast.ok('Demo data loaded.'),
              onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Could not load demo data.'),
            })
          }
        >
          {loadDemo.isPending ? 'Loading…' : 'Load demo data'}
        </button>
        {canLoad.data && !canLoad.data.available ? (
          <p className="text-[11.5px] text-faint">
            Unavailable: this system already has people, a rota, or time off recorded.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        <h3 className="text-base font-semibold text-bad">Reset to empty</h3>
        <p className="text-[12px] text-muted">
          Deletes every location, unit, person, shift, absence, comp day and role grant,
          and returns to the migrated-but-empty state — the next visit shows the setup
          wizard again. This does not drop the database; nothing entered by hand survives
          it.
        </p>
        <label className="flex flex-col gap-1 text-[11.5px] text-faint">
          Type RESET to confirm
          <input
            type="text"
            className="field w-40 py-0.5 font-mono text-[12px]"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="Type RESET to confirm"
          />
        </label>
        <button
          type="button"
          className="btn btn--sm btn--danger self-start"
          disabled={confirmText !== 'RESET' || reset.isPending}
          onClick={() =>
            reset.mutate(undefined, {
              onSuccess: () => setConfirmText(''),
              onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Reset failed.'),
            })
          }
        >
          {reset.isPending ? 'Resetting…' : 'Reset to empty'}
        </button>
      </section>

      <AllowedCalendarHostsSection />
    </div>
  );
}

/**
 * Which hosts the holiday import (Settings → Holidays) may fetch a calendar feed from.
 *
 * WHY here and not on the Holidays tab: it used to be `Holidays:AllowedCalendarHosts` in
 * `appsettings`, which cost a redeploy to change and was invisible on the one screen that
 * names the risk it exists to contain — an admin endpoint that fetches an arbitrary URL is
 * a request-forgery proxy pointed at whatever the server can reach. It lives beside Reset
 * because both are global, system-wide controls rather than day-to-day editing.
 */
function AllowedCalendarHostsSection() {
  const hosts = useAllowedCalendarHosts();
  const add = useAddAllowedCalendarHost();
  const remove = useRemoveAllowedCalendarHost();
  const [draft, setDraft] = useState('');

  const submit = () => {
    const host = draft.trim();
    if (!host) return;
    add.mutate(host, {
      onSuccess: () => setDraft(''),
      onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Could not add that host.'),
    });
  };

  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h3 className="text-base font-semibold">Holiday-import allowlist</h3>
      <p className="text-[12px] text-muted">
        Hosts the holiday import may fetch a calendar feed from. A host not listed here is
        refused, even if a caller pastes its exact URL — the allowlist is the whole of what
        keeps that endpoint from being pointed at an arbitrary address.
      </p>
      <ul className="flex flex-col gap-1">
        {(hosts.data ?? []).map((h) => (
          <li key={h.host} className="flex items-center gap-2 text-[12.5px]">
            <span className="font-mono">{h.host}</span>
            <button
              type="button"
              className="btn btn--sm btn--ghost text-bad"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(h.host, {
                  onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Could not remove that host.'),
                })
              }
            >
              Remove
            </button>
          </li>
        ))}
        {hosts.data?.length === 0 ? <li className="text-[12px] text-faint">Nothing allowed yet — every import will be refused.</li> : null}
      </ul>
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="field w-64 py-0.5 font-mono text-[12px]"
          value={draft}
          placeholder="calendar.example.com"
          aria-label="Add a calendar host"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className="btn btn--sm" disabled={!draft.trim() || add.isPending} onClick={submit}>
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </section>
  );
}
