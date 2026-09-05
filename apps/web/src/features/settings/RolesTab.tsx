import { useState } from 'react';
import { CheckboxField } from './fields.tsx';
import { APP_ROLES, type AppRole } from '../../domain/types.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { useDirectoryRoles, useGrantRole, useRevokeRole, useRoleAssignments, useSetDirectoryRoles } from '../../api/roleAssignments.ts';
import { ApiError } from '../../api/client.ts';
import { toast } from '../../ui/toasts.ts';
import { type Reference } from './shared.tsx';

/**
 * Whether this screen is telling the whole truth (ADR-0062, ADR-0063).
 *
 * With directory roles on, a person can hold a role that has no tick below, that nobody
 * can revoke from here, and that ticking the box would *duplicate* rather than replace.
 * The switch therefore belongs on this screen and not in a deploy file: it changes what
 * everything under it means.
 *
 * Only a global Admin may change it — it is not scoped to a unit and cannot be, so an
 * administrator of one unit must not widen every unit.
 */
function DirectoryRolesNotice() {
  const caps = useCapabilities();
  const current = useDirectoryRoles();
  const set = useSetDirectoryRoles();
  const enabled = current.data?.enabled ?? false;

  if (current.isPending) return null;

  return (
    <section className={`card p-3 ${enabled ? 'border-warn' : ''}`}>
      <label className="flex items-center gap-2 text-[12px]">
        <CheckboxField
          checked={enabled}
          ariaLabel="Honour Entra ID app roles"
          onChange={(v) =>
            set.mutate(v, {
              onError: (err) =>
                toast.bad(
                  err instanceof ApiError ? err.message : 'The setting could not be changed.',
                ),
            })
          }
        />
        Also honour Entra ID app roles
      </label>
      <p className="mt-1 text-[11.5px] text-faint">
        {enabled
          ? 'On: somebody may hold a role that has no tick below, granted in the directory and revocable only there. This list is not the whole picture.'
          : 'Off: every role anybody holds is a tick below. Turning it on adds a second, global source that this screen cannot show.'}
      </p>
      {!caps.canAdministerGlobally ? (
        <p className="mt-1 text-[11.5px] text-faint">
          Changing it takes a global Admin — it affects every unit at once.
        </p>
      ) : null}
    </section>
  );
}

/** Sentinel for the "every unit" tab; a real unit id can never be empty. */
const GLOBAL_SCOPE = '';

/** Viewer is what everyone signed in already holds, so it is not grantable. */
const GRANTABLE = APP_ROLES.filter((role) => role !== 'Viewer');

export function RolesTab({ reference }: { readonly reference: Reference }) {
  const [scope, setScope] = useState<string>(reference.units[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [grantedOnly, setGrantedOnly] = useState(false);
  const caps = useCapabilities();
  const grants = useRoleAssignments();
  const grant = useGrantRole();
  const revoke = useRevokeRole();

  const unitId = scope === GLOBAL_SCOPE ? null : scope;
  const mayEdit = unitId === null ? caps.canAdministerGlobally : caps.canAdminister(unitId);

  const held = new Map<string, string>();
  for (const row of grants.data ?? []) {
    if ((row.unitId ?? null) === unitId) held.set(`${row.personId}|${row.role}`, row.id);
  }

  // "Who approves EMEA's leave" over eighty rows of mostly-empty checkboxes was a scroll,
  // not an answer.
  const needle = query.trim().toLowerCase();
  const rows = [...reference.people]
    .filter((person) => person.isActive)
    .filter((person) => !needle || person.displayName.toLowerCase().includes(needle))
    .filter((person) => !grantedOnly || GRANTABLE.some((role) => held.has(`${person.id}|${role}`)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // A grant is one immediate write, unlike every other tab's Save All — so a failure has
  // to say so itself. It used to fail silently and leave the box looking ticked.
  const toggle = (personId: string, role: AppRole) => {
    const existing = held.get(`${personId}|${role}`);
    const onError = (err: unknown) =>
      toast.bad(err instanceof ApiError ? err.message : 'The grant could not be changed.');
    if (existing) revoke.mutate(existing, { onError });
    else grant.mutate({ personId, unitId, role }, { onError });
  };

  return (
    <div className="flex flex-col gap-3">
      <DirectoryRolesNotice />

      <div className="settings-toolbar">
        <span className="text-[12px] font-medium">Grants in</span>
        <div className="segmented">
          {reference.units.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className="segmented__item"
              data-active={scope === unit.id}
              onClick={() => setScope(unit.id)}
            >
              {unit.name}
            </button>
          ))}
          <button
            type="button"
            className="segmented__item"
            data-active={scope === GLOBAL_SCOPE}
            onClick={() => setScope(GLOBAL_SCOPE)}
            title="Roles that apply in every unit, and configuration that belongs to none"
          >
            Every unit
          </button>
        </div>
        <input
          type="search"
          className="field w-48 py-0.5"
          value={query}
          placeholder="Find a person"
          aria-label="Find a person"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-[11.5px]">
          <input type="checkbox" checked={grantedOnly} onChange={(e) => setGrantedOnly(e.target.checked)} />
          Only people with a grant here
        </label>
      </div>

      {mayEdit ? null : (
        <p className="text-[12px] text-warn">
          {unitId === null
            ? 'Only a global administrator can grant a role in every unit.'
            : 'You do not administer this unit, so these grants are read-only for you.'}
        </p>
      )}

      <table className="rows">
        <thead>
          <tr>
            <th className="text-left">Person</th>
            {GRANTABLE.map((role) => (
              <th key={role} className="w-[110px] text-left">
                {role}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => (
            <tr key={person.id}>
              <td>
                <span className="font-medium">{person.displayName}</span>
                <span className="ml-2 text-[11px] text-faint">{person.unitId}</span>
              </td>
              {GRANTABLE.map((role) => {
                // The wire writes AppRole in PascalCase (ADR-0066), so the key is the
                // role as it arrives. Lower-casing it here is what made every box read
                // as unticked once the server stopped sending 'planner'.
                const on = held.has(`${person.id}|${role}`);
                return (
                  <td key={role}>
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!mayEdit}
                        onChange={() => toggle(person.id, role)}
                        aria-label={`${role} for ${person.displayName}`}
                      />
                      <span className="text-faint">{on ? 'yes' : '—'}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
