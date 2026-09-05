import { useId, useState } from 'react';
import { type AdminPersonSummary } from '../../api/admin.ts';
import { CheckboxField, FieldErrorList, NativeSelectField, TextField } from './fields.tsx';
import { type Reference, type Edits, EditableTable } from './shared.tsx';

export function PeopleTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  // ~80 rows in one flat table: finding one person meant Ctrl+F, and Ctrl+F does not
  // reach a `<select>`'s current value.
  const [query, setQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const rows: AdminPersonSummary[] = reference.people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    initials: p.initials,
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.email ? { email: p.email } : {}),
    unitId: p.unitId,
    locationId: p.locationId,
    orgCategory: p.orgCategory,
    isActive: p.isActive,
    isIncluded: p.isIncluded,
  }));

  const needle = query.trim().toLowerCase();
  const visible = rows
    .filter((r) => !unitFilter || r.unitId === unitFilter)
    .filter((r) => !activeOnly || r.isActive)
    .filter(
      (r) =>
        !needle ||
        r.displayName.toLowerCase().includes(needle) ||
        (r.email ?? '').toLowerCase().includes(needle) ||
        (r.employeeId ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="flex flex-col gap-3">
      <div className="settings-toolbar">
        <input
          type="search"
          className="field w-56 py-0.5"
          value={query}
          placeholder="Name, email or employee ID"
          aria-label="Search people"
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelectField
          value={unitFilter}
          ariaLabel="Filter by unit"
          options={[{ value: '', label: 'Every unit' }, ...reference.units.map((u) => ({ value: u.id, label: u.name }))]}
          onChange={setUnitFilter}
        />
        <label className="flex items-center gap-1.5 text-[11.5px]">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <span className="text-[11.5px] text-faint">
          {visible.length} of {rows.length}
        </span>
      </div>
      <EditableTable
      title="person"
      rows={visible}
      entity="person"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        displayName: '',
        initials: '',
        employeeId: '',
        email: '',
        unitId: reference.units[0]?.id ?? '',
        locationId: reference.locations[0]?.id ?? '',
        orgCategory: 'SUPPORT',
        isActive: true,
        isIncluded: true,
      }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Initials</th>
          <th>Employee ID</th>
          <th>Email (sign-in)</th>
          <th>Unit</th>
          <th>Location</th>
          <th>Active</th>
          <th>Included</th>
          <th />
        </tr>
      )}
      renderRow={(draft: AdminPersonSummary, setField, errors) => (
        <>
          <td>
            <TextField value={draft.displayName} ariaLabel="Name" onChange={(v) => setField('displayName', v)} />
            <FieldErrorList errors={errors?.displayName} />
          </td>
          <td>
            <TextField mono value={draft.initials} ariaLabel="Initials" onChange={(v) => setField('initials', v)} />
          </td>
          <td>
            {/* External key an HR import will eventually match people by
                (already tried first, client-side, by AbsenceImportDialog's
                matchPeople) — unique once set, enforced server-side. */}
            <TextField
              mono
              value={draft.employeeId ?? ''}
              ariaLabel="Employee ID"
              onChange={(v) => setField('employeeId', v)}
            />
            <FieldErrorList errors={errors?.employeeId} />
          </td>
          <td>
            {/* What an Entra ID sign-in resolves to this person by (ADR-0058). Blank
                means they cannot sign in — the token's email matches nobody and the API
                answers 403 PRINCIPAL_NOT_MAPPED, naming the address to link. */}
            <TextField
              mono
              value={draft.email ?? ''}
              ariaLabel="Email (sign-in)"
              onChange={(v) => setField('email', v)}
            />
            <FieldErrorList errors={errors?.email} />
          </td>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => setField('unitId', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.locationId}
              ariaLabel="Location"
              options={reference.locations.map((l) => ({ value: l.id, label: l.name }))}
              onChange={(v) => setField('locationId', v)}
            />
          </td>
          <td>
            <CheckboxField checked={draft.isActive} ariaLabel="Active" onChange={(v) => setField('isActive', v)} />
          </td>
          <td>
            <CheckboxField checked={draft.isIncluded} ariaLabel="Included" onChange={(v) => setField('isIncluded', v)} />
          </td>
        </>
      )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display — display timezone, moved off the header's clock strip
// ---------------------------------------------------------------------------

/**
 * Display timezone moved off a click on the header's location clocks
 * (`AppShell.tsx`'s `LocationClockStrip`, now a read-only indicator) — that
 * changed exactly two tooltip strings on Overview and nothing else, which
 * read as broken rather than as a working control.
 */
// DisplayTab moved to the profile menu (features/shell/DisplayMenu.tsx): Settings is
// admin-only now, and which timezone you read the grid in is everybody’s preference.

// ---------------------------------------------------------------------------
// Generic editable table: existing rows + one pending "new row" + delete
// ---------------------------------------------------------------------------
