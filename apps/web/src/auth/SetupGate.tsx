/**
 * The setup wizard, and the gate that shows it instead of the app (ADR-0059).
 *
 * WHY it sits above `AuthProvider`, inside `EntraGate`: `GET /api/setup/state` is
 * anonymous and has to answer before `/api/auth/me` is reachable at all — the server
 * refuses every other route with `SETUP_REQUIRED` while no `SystemSetup` row exists,
 * `/api/auth/me` included. It needs to be *inside* `EntraGate` (not above it, the way the
 * calendar feed route never touches the client at all) because completing the Bare or
 * Demo preset outside Stub mode reads the caller's email and name off their own bearer
 * token — there is nothing to send until MSAL has one.
 */

import { useState, type ReactNode } from 'react';
import { NativeSelectField, TextField } from '../features/settings/fields.tsx';
import { toast } from '../ui/toasts.ts';
import { ApiError } from '../api/client.ts';
import { useCompleteSetup, useSetupState, type SetupPreset } from '../api/setup.ts';
import type { UnitKind } from '../domain/types.ts';

export function SetupGate({ children }: { readonly children: ReactNode }) {
  const { data, isPending, isError, refetch } = useSetupState();

  if (isPending) {
    return <FullScreenMessage title="Loading…" body="Checking whether this system is set up." />;
  }

  if (isError) {
    return (
      <FullScreenMessage
        title="Could not reach the server"
        body="The setup check failed. If the API just started, it may still be coming up."
        action={{ label: 'Try again', onClick: () => void refetch() }}
      />
    );
  }

  if (!data.required) return <>{children}</>;

  return <SetupWizard stubMode={data.stubMode} />;
}

function FullScreenMessage({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="grid h-screen place-items-center p-8">
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

const UNIT_KIND_OPTIONS = [
  { value: 'REGION', label: 'Region' },
  { value: 'CROSS_REGION', label: 'Cross-region' },
];

function SetupWizard({ stubMode }: { readonly stubMode: boolean }) {
  const [preset, setPreset] = useState<SetupPreset | undefined>(undefined);
  const [locationName, setLocationName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [holidayCalendarKey, setHolidayCalendarKey] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitKind, setUnitKind] = useState<UnitKind>('CROSS_REGION');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const complete = useCompleteSetup();

  const bareFieldsFilled =
    locationName.trim() !== '' && timeZone.trim() !== '' && holidayCalendarKey.trim() !== '' && unitName.trim() !== ''
    && (!stubMode || (displayName.trim() !== '' && email.trim() !== ''));

  const submit = () => {
    if (!preset) return;
    complete.mutate(
      {
        preset,
        ...(preset === 'Bare'
          ? {
              bare: {
                locationName,
                timeZone,
                holidayCalendarKey,
                unitName,
                unitKind,
                ...(stubMode ? { displayName, email } : {}),
              },
            }
          : {}),
      },
      {
        onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Setup failed.'),
      },
    );
  };

  return (
    <div className="mx-auto flex h-screen max-w-[720px] flex-col justify-center gap-4 p-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Set up shift-o-mator</h1>
        <p className="mt-1 text-base text-muted">
          This system has no data yet. Choose how it should start — this runs once.
        </p>
      </header>

      <div className="flex gap-3">
        <PresetCard
          title="Bare"
          body="One location, one planning unit, and you as the administrator. Everything else is entered on Settings afterward."
          selected={preset === 'Bare'}
          onSelect={() => setPreset('Bare')}
        />
        <PresetCard
          title="Demo"
          body="A realistic fixture: four planning units, a trimmed roster, shifts, and a sample rota — for evaluation or local development."
          selected={preset === 'Demo'}
          onSelect={() => setPreset('Demo')}
        />
      </div>

      {preset === 'Bare' ? (
        <section className="card flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Location name">
              <TextField value={locationName} onChange={setLocationName} ariaLabel="Location name" />
            </Labeled>
            <Labeled label="Time zone">
              <TextField value={timeZone} onChange={setTimeZone} ariaLabel="Time zone" placeholder="America/Chicago" mono />
            </Labeled>
            <Labeled label="Holiday calendar key">
              <TextField
                value={holidayCalendarKey}
                onChange={setHolidayCalendarKey}
                ariaLabel="Holiday calendar key"
                placeholder="us-federal"
                mono
              />
            </Labeled>
            <Labeled label="Planning unit name">
              <TextField value={unitName} onChange={setUnitName} ariaLabel="Planning unit name" />
            </Labeled>
            <Labeled label="Planning unit kind">
              <NativeSelectField
                value={unitKind}
                options={UNIT_KIND_OPTIONS}
                onChange={(v) => setUnitKind(v as UnitKind)}
                ariaLabel="Planning unit kind"
              />
            </Labeled>
          </div>

          {stubMode ? (
            <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
              <Labeled label="Your name">
                <TextField value={displayName} onChange={setDisplayName} ariaLabel="Your name" />
              </Labeled>
              <Labeled label="Your email">
                <TextField value={email} onChange={setEmail} ariaLabel="Your email" mono />
              </Labeled>
            </div>
          ) : (
            <p className="text-[11.5px] text-faint">
              You will be created as the administrator using the name and email in your sign-in.
            </p>
          )}
        </section>
      ) : null}

      <button
        type="button"
        className="btn btn--primary self-start"
        disabled={!preset || (preset === 'Bare' && !bareFieldsFilled) || complete.isPending}
        onClick={submit}
      >
        {complete.isPending ? 'Setting up…' : 'Set up'}
      </button>
    </div>
  );
}

function PresetCard({
  title,
  body,
  selected,
  onSelect,
}: {
  readonly title: string;
  readonly body: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="card flex-1 p-4 text-left"
      data-active={selected}
      onClick={onSelect}
      style={selected ? { borderColor: 'var(--accent)' } : undefined}
    >
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-1 text-[12px] text-muted">{body}</p>
    </button>
  );
}

function Labeled({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11.5px] text-faint">
      {label}
      {children}
    </label>
  );
}
