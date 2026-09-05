import { useId, useState } from 'react';
import { type Holiday } from '../../domain/types.ts';
import { CheckboxField, FieldErrorList, NativeSelectField, TextField } from './fields.tsx';
import { HolidayImport } from './HolidayImport.tsx';
import { type Reference, type Edits, EditableTable } from './shared.tsx';

export function HolidaysTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  // The table grows by a year of days per import and never shrinks, so the default view
  // is the year in hand rather than every year ever loaded.
  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(thisYear);
  const [locationFilter, setLocationFilter] = useState('');
  const years = [...new Set(reference.holidays.map((h) => h.date.slice(0, 4)))].sort();
  const sorted = [...reference.holidays]
    .filter((h) => !year || h.date.startsWith(year))
    .filter((h) => !locationFilter || h.locationIds.includes(locationFilter))
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex flex-col gap-3">
      <HolidayImport locations={reference.locations} />
      <div className="settings-toolbar">
        <NativeSelectField
          value={year}
          ariaLabel="Filter by year"
          options={[{ value: '', label: 'Every year' }, ...years.map((y) => ({ value: y, label: y }))]}
          onChange={setYear}
        />
        <NativeSelectField
          value={locationFilter}
          ariaLabel="Filter by location"
          options={[{ value: '', label: 'Every location' }, ...reference.locations.map((l) => ({ value: l.id, label: l.name }))]}
          onChange={setLocationFilter}
        />
        <span className="text-[11.5px] text-faint">
          {sorted.length} of {reference.holidays.length}
        </span>
      </div>
      <EditableTable
      title="holiday"
      rows={sorted}
      entity="holiday"
      edits={edits}
      newTempId={tempId}
      newInitial={{ date: '', name: '', locationIds: [], isFullDay: true }}
      renderHeader={() => (
        <tr>
          <th>Date</th>
          <th>Name</th>
          <th>Locations</th>
          <th>Full day</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Holiday, setField, errors) => (
        <>
          <td>
            <input type="date" className="field py-0.5 font-mono text-[12px]" value={draft.date} onChange={(e) => setField('date', e.target.value)} />
          </td>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td className="flex flex-wrap gap-2">
            {reference.locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.locationIds.includes(loc.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...draft.locationIds, loc.id]
                      : draft.locationIds.filter((id) => id !== loc.id);
                    setField('locationIds', next);
                  }}
                />
                {loc.name}
              </label>
            ))}
          </td>
          <td>
            <CheckboxField checked={draft.isFullDay} ariaLabel="Full day" onChange={(v) => setField('isFullDay', v)} />
          </td>
        </>
      )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Units — Phase 8 merged what used to be Region here: name, primary
// location, member locations, comp-off policy, alongside Kind/GroupBy.
// ---------------------------------------------------------------------------
