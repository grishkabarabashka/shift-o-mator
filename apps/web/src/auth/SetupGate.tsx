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
import { CheckboxField, NativeSelectField, TextField } from '../features/settings/fields.tsx';
import { toast } from '../ui/toasts.ts';
import { ApiError } from '../api/client.ts';
import {
  useCompleteSetup,
  useFinishSetup,
  useSetupDiagnostics,
  useSetupState,
  type SetupDiagnostics,
  type SetupPreset,
  type SetupResult,
} from '../api/setup.ts';
import { AUTH_MODE } from './entraConfig.ts';
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
  const [plans, setPlans] = useState(true);
  const [approves, setApproves] = useState(true);
  const [directoryRoles, setDirectoryRoles] = useState(false);
  const [done, setDone] = useState<SetupResult | undefined>(undefined);

  const complete = useCompleteSetup();
  const diagnostics = useSetupDiagnostics();

  const bareFieldsFilled =
    locationName.trim() !== '' && timeZone.trim() !== '' && holidayCalendarKey.trim() !== '' && unitName.trim() !== ''
    && (!stubMode || (displayName.trim() !== '' && email.trim() !== ''));

  const submit = () => {
    if (!preset) return;
    complete.mutate(
      {
        preset,
        directoryRoles,
        ...(preset === 'BARE'
          ? {
              bare: {
                locationName,
                timeZone,
                holidayCalendarKey,
                unitName,
                unitKind,
                ...(stubMode ? { displayName, email } : {}),
                roles: [
                  ...(plans ? (['Planner'] as const) : []),
                  ...(approves ? (['Approver'] as const) : []),
                ],
              },
            }
          : {}),
      },
      {
        onSuccess: setDone,
        onError: (err) => toast.bad(err instanceof ApiError ? err.message : 'Setup failed.'),
      },
    );
  };

  if (done) return <SetupSummary result={done} />;

  return (
    <div className="mx-auto flex h-screen max-w-[720px] flex-col justify-center gap-4 p-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Set up shift-o-mator</h1>
        <p className="mt-1 text-base text-muted">
          This system has no data yet. Choose how it should start — this runs once.
        </p>
      </header>

      {diagnostics.data ? <WhoAmI diagnostics={diagnostics.data} /> : null}

      <div className="flex gap-3">
        <PresetCard
          title="Bare"
          body="One location, one planning unit, and you as the administrator. Everything else is entered on Settings afterward."
          selected={preset === 'BARE'}
          onSelect={() => setPreset('BARE')}
        />
        <PresetCard
          title="Demo"
          body="A realistic fixture: four planning units, a trimmed roster, shifts, and a sample rota — for evaluation or local development."
          selected={preset === 'DEMO'}
          onSelect={() => setPreset('DEMO')}
        />
      </div>

      {preset === 'BARE' ? (
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

      {preset ? (
        <section className="card flex flex-col gap-3 p-4">
          <div>
            <h2 className="text-[12px] font-semibold">Access</h2>
            {preset === 'BARE' ? (
              <p className="mt-1 text-[11.5px] text-faint">
                You are always an Admin — that is what reaches Settings, and a system whose only
                account cannot get there has no way back. The rest is asked because no role
                implies another: an Admin who is not a Planner cannot open a draft.
              </p>
            ) : (
              <p className="mt-1 text-[11.5px] text-faint">
                The demo fixture brings its own grants — every manager plans, approves and
                administers their own unit. Edit them afterward on Settings → Roles.
              </p>
            )}
          </div>

          {preset === 'BARE' ? (
            <div className="flex flex-col gap-1.5">
              {/* Stated, not shown as a ticked box nobody can untick: a disabled control
                  invites the click it then refuses. */}
              <p className="text-[12px]">Administers settings — always</p>
              <Toggle checked={plans} onChange={setPlans} label="Plans the rota" />
              <Toggle checked={approves} onChange={setApproves} label="Approves requests" />
            </div>
          ) : null}

          <div className="border-t border-hairline pt-3">
            <Toggle
              checked={directoryRoles}
              onChange={setDirectoryRoles}
              label="Also honour Entra ID app roles"
            />
            <p className="mt-1 text-[11.5px] text-faint">
              Off by default. A role granted in the directory is always global, does not appear on
              Settings → Roles and cannot be revoked from here — so the screen that lists
              permissions would stop showing all of them. Changeable later.
            </p>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="btn btn--primary self-start"
        disabled={!preset || (preset === 'BARE' && !bareFieldsFilled) || complete.isPending}
        onClick={submit}
      >
        {complete.isPending ? 'Setting up…' : 'Set up'}
      </button>
    </div>
  );
}

/**
 * Who is doing the setting up, as the *server* sees them.
 *
 * The wizard used to say nothing about this, and it was the source of the one question
 * nobody could answer from the screen: the Demo preset writes your token's email onto
 * whichever fixture person holds the global Admin grant, so people arrived in a system
 * where their address belonged to a stranger with no explanation anywhere.
 *
 * It also catches the mismatch nothing else does. The client's mode is baked into its
 * build (`VITE_AUTH_MODE`) and the server's is chosen at startup (`Auth:Mode`); when they
 * disagree the symptom is either a token nobody validates or no token at all, and the
 * error it produces names neither half (ADR-0063).
 */
function WhoAmI({ diagnostics }: { readonly diagnostics: SetupDiagnostics }) {
  const serverIsEntra = diagnostics.auth.mode.toLowerCase() !== 'stub';
  const clientIsEntra = AUTH_MODE === 'entra';
  const mismatched = serverIsEntra !== clientIsEntra;

  return (
    <section className="card flex flex-col gap-2 p-4">
      <h2 className="text-[12px] font-semibold">Signing in as</h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-faint">Identity</dt>
        <dd className="truncate">
          {diagnostics.caller.displayName ?? 'unknown'}
          {diagnostics.caller.tokenEmail ? (
            <span className="ml-1 text-faint">({diagnostics.caller.tokenEmail})</span>
          ) : null}
        </dd>

        <dt className="text-faint">Server auth</dt>
        <dd>
          {diagnostics.auth.mode}
          {diagnostics.auth.audience ? (
            <span className="ml-1 text-faint">· {diagnostics.auth.audience}</span>
          ) : null}
        </dd>

        <dt className="text-faint">Roles</dt>
        <dd>
          {diagnostics.caller.grants.length === 0
            ? 'none yet — setup grants them'
            : diagnostics.caller.grants
                .map((g) => `${g.role}${g.unitId ? ` (${g.unitId})` : ''}`)
                .join(', ')}
        </dd>
      </dl>

      {mismatched ? (
        <p className="text-[11.5px] text-warn">
          This browser was built for <strong>{clientIsEntra ? 'Entra ID' : 'stub'}</strong> sign-in
          and the server runs <strong>{diagnostics.auth.mode}</strong>. Both halves have to match,
          or the token is ignored or never sent — and neither side says so on its own.
        </p>
      ) : null}
    </section>
  );
}

/**
 * What was written, and — the part that matters — what was not.
 *
 * The Bare preset deliberately leaves a system nobody can plan in: a unit with no shifts
 * and no day configurations, and one person who is `isIncluded = false` because they exist
 * to administer rather than to be rostered. That is the right thing for a preset called
 * Bare, and saying nothing about it left people staring at an empty grid deciding the
 * product was broken.
 */
function SetupSummary({ result }: { readonly result: SetupResult }) {
  const diagnostics = useSetupDiagnostics();
  const finish = useFinishSetup();
  const content = diagnostics.data?.content;

  const missing = content
    ? [
        content.plannedPeople === 0
          ? { what: 'Nobody to plan', where: 'Settings → People, or the People screen' }
          : undefined,
        content.shifts === 0 ? { what: 'No shifts', where: 'Settings → Shifts' } : undefined,
        content.dayConfigurations === 0
          ? { what: 'No day configurations', where: 'Settings → Day configurations' }
          : undefined,
      ].filter((x): x is { what: string; where: string } => x !== undefined)
    : [];

  return (
    <div className="mx-auto flex h-screen max-w-[720px] flex-col justify-center gap-4 p-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">This system is set up</h1>
        <p className="mt-1 text-base text-muted">
          {result.preset === 'DEMO'
            ? 'The demo fixture is in place.'
            : 'A location, a planning unit and your administrator account are in place.'}
          {result.adminDisplayName ? ` You are ${result.adminDisplayName}.` : ''}
        </p>
      </header>

      {result.preset === 'DEMO' && result.adminDisplayName ? (
        <p className="text-[12px] text-muted">
          Your sign-in address was linked to <strong>{result.adminDisplayName}</strong> — the person
          the fixture gives the global Admin grant to. That is how you sign back in; change it on
          Settings → People if you would rather be somebody else.
        </p>
      ) : null}

      {missing.length > 0 ? (
        <section className="card flex flex-col gap-2 p-4">
          <h2 className="text-[12px] font-semibold">Before you can plan</h2>
          <ul className="flex flex-col gap-1">
            {missing.map((item) => (
              <li key={item.what} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span>{item.what}</span>
                <span className="text-[11px] text-faint">{item.where}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint">
            Deliberate, not missing: a bare system starts empty so nothing is invented for you.
          </p>
        </section>
      ) : null}

      <button type="button" className="btn btn--primary self-start" onClick={finish}>
        Open shift-o-mator
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

/** A checkbox with its text beside it. `CheckboxField` carries no label of its own —
 * in the Settings tables the column header is the label — and widening it for this
 * screen would change every one of those. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px]">
      <CheckboxField checked={checked} onChange={onChange} ariaLabel={label} />
      {label}
    </label>
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
