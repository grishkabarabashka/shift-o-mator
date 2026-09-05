import { useId } from 'react';
import { type Location } from '../../domain/types.ts';
import { FieldErrorList, TextField, TimeZoneField } from './fields.tsx';
import { type Reference, type Edits, EditableTable, WeekdaysEditor } from './shared.tsx';

export function LocationsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="location"
      rows={reference.locations}
      entity="location"
      edits={edits}
      newTempId={tempId}
      newInitial={{ name: '', country: '', timeZone: '', holidayCalendarKey: '', weekendDays: [6, 7] }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Country</th>
          <th>Time zone</th>
          <th>Holiday calendar</th>
          <th>Weekend</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Location, setField, errors) => (
        <>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td>
            <TextField value={draft.country} ariaLabel="Country" onChange={(v) => setField('country', v)} />
          </td>
          <td>
            <TimeZoneField value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
          </td>
          <td>
            <TextField mono value={draft.holidayCalendarKey} ariaLabel="Holiday calendar key" onChange={(v) => setField('holidayCalendarKey', v)} />
          </td>
          <td>
            <WeekdaysEditor value={draft.weekendDays} onChange={(v) => setField('weekendDays', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Shifts — Phase 8 merged the old ShiftRole/ShiftDefinition split
// ---------------------------------------------------------------------------
