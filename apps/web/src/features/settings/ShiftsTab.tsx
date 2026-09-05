import { useId } from 'react';
import { type Shift } from '../../domain/types.ts';
import { CheckboxField, FieldErrorList, NativeSelectField, NumberField, TextField, TimeField, TimeZoneField } from './fields.tsx';
import { type Reference, type Edits, EditableTable } from './shared.tsx';

export function ShiftsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="shift"
      rows={reference.shifts}
      entity="shift"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        unitId: reference.units[0]?.id ?? '',
        code: '',
        label: '',
        color: '#888888',
        timeZone: reference.units[0]?.locationIds[0] ? reference.locations.find((l) => l.id === reference.units[0]?.locationIds[0])?.timeZone ?? '' : '',
        start: '09:00',
        end: '18:00',
        crossesMidnight: false,
        breakMinutes: 0,
        countsAsCoverage: true,
        editableTime: false,
      }}
      renderHeader={() => (
        <tr>
          <th className="w-[130px]">Unit</th>
          <th className="w-[110px]">Code</th>
          <th className="min-w-[190px]">Label</th>
          <th>Color</th>
          <th>Hotkey</th>
          <th>Window</th>
          <th className="w-[80px]" title="The window ends on the next day — 22:00–06:00 is one shift, not an eight-hour gap">
            Overnight
          </th>
          <th className="w-[110px]">Break</th>
          <th className="w-[170px]">Zone</th>
          <th className="w-[130px]">Counts as coverage</th>
          <th />
        </tr>
      )}
      renderRow={(draft: Shift, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => setField('unitId', v)}
            />
          </td>
          <td>
            <TextField mono value={draft.code} ariaLabel="Code" onChange={(v) => setField('code', v)} />
            <FieldErrorList errors={errors?.code} />
          </td>
          <td>
            <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
          </td>
          <td>
            <input
              type="color"
              value={draft.color}
              aria-label="Color"
              onChange={(e) => setField('color', e.target.value)}
            />
          </td>
          <td>
            <TextField mono value={draft.hotkey ?? ''} ariaLabel="Hotkey" onChange={(v) => setField('hotkey', v || undefined)} />
          </td>
          <td className="flex items-center gap-1">
            <TimeField value={draft.start} ariaLabel="Start" onChange={(v) => setField('start', v)} />
            <span className="text-faint">–</span>
            <TimeField value={draft.end} ariaLabel="End" onChange={(v) => setField('end', v)} />
          </td>
          <td>
            {/* Read by `engine/dates.ts` to place the end of the window on the next day. It
                was stored and editable nowhere, so a night shift created here came out as a
                window running backwards. */}
            <CheckboxField
              checked={draft.crossesMidnight}
              ariaLabel="Crosses midnight"
              onChange={(v) => setField('crossesMidnight', v)}
            />
          </td>
          <td className="whitespace-nowrap">
            <NumberField
              min={0}
              value={draft.breakMinutes}
              ariaLabel="Break minutes"
              onChange={(v) => setField('breakMinutes', v)}
            />
            <span className="ml-1 text-faint">min</span>
            <FieldErrorList errors={errors?.breakMinutes} />
          </td>
          <td>
            <TimeZoneField value={draft.timeZone} ariaLabel="Time zone" onChange={(v) => setField('timeZone', v)} />
          </td>
          <td>
            <CheckboxField checked={draft.countsAsCoverage} ariaLabel="Counts as coverage" onChange={(v) => setField('countsAsCoverage', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Day configurations — history + create-new-version
// ---------------------------------------------------------------------------
