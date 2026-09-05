import { useId } from 'react';
import { type EventType } from '../../domain/types.ts';
import { FieldErrorList, NativeSelectField, NumberField, TextField } from './fields.tsx';
import { type Reference, type Edits, EditableTable, GlobalAdminNotice } from './shared.tsx';

/**
 * Kinds of non-working day (ADR-0049).
 *
 * The colour is the one that fills the cell, and the short label is what a 62px column
 * shows — both are here because both are matters of taste that changed twice in review and
 * should not need a deployment to change a third time.
 *
 * There is **no delete**: absences point at these by id, so a retired kind is unticked
 * rather than removed and keeps its name for the rows that already use it.
 */
export function EventTypesTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const sorted = [...reference.eventTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <GlobalAdminNotice reference={reference} what="Kinds of leave" />

      <EditableTable
        title="leave type"
        rows={sorted}
        entity="eventType"
        edits={edits}
        newTempId={tempId}
        showDelete={false}
        newInitial={{
          code: '',
          label: '',
          shortLabel: '',
          color: '#9aa3ad',
          category: 'OTHER',
          blocksAssignment: true,
          countsTowardCapacity: true,
          requiresApproval: true,
          allowsHalfDay: true,
          isActive: true,
          sortOrder: sorted.length + 1,
        }}
        renderHeader={() => (
          <tr>
            <th>Label</th>
            <th className="w-[130px]" title="The stable key imports and the seed match on. Fixed once created.">
              Code
            </th>
            <th className="w-[90px]">In the cell</th>
            <th className="w-[70px]">Colour</th>
            <th className="w-[120px]">Category</th>
            <th className="w-[80px]" title="Closes the day out — a shift on it is flagged as a conflict">
              Blocks
            </th>
            <th className="w-[90px]" title="Counted against the simultaneous-absence limit">
              Capacity
            </th>
            <th className="w-[90px]" title="Has to be requested and approved, by anybody — planners included">
              Approval
            </th>
            <th className="w-[80px]">Half day</th>
            <th className="w-[70px]" title="Unticking retires it; existing absences keep their name">
              Active
            </th>
            <th className="w-[70px]" title="Where it sits in the cell menu — Presence has the same column">
              Order
            </th>
            <th />
          </tr>
        )}
        renderRow={(draft: EventType, setField, errors) => (
          <>
            <td>
              <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
              <FieldErrorList errors={errors?.label} />
            </td>
            <td>
              {/* Required by the server and rendered by nothing, so "+ New leave type" was a
                  row that could only ever come back 400 with the offending field off-screen.
                  Fixed after creation: it is the key absences and the seed match on, and the
                  update path does not check a changed one for collisions. */}
              {draft.id ? (
                <span className="font-mono text-[11.5px] text-faint">{draft.code}</span>
              ) : (
                <>
                  <TextField mono value={draft.code} ariaLabel="Code" placeholder="SABBATICAL" onChange={(v) => setField('code', v)} />
                  <FieldErrorList errors={errors?.code} />
                </>
              )}
            </td>
            <td>
              <TextField
                value={draft.shortLabel}
                ariaLabel="Short label"
                onChange={(v) => setField('shortLabel', v)}
              />
              <FieldErrorList errors={errors?.shortLabel} />
            </td>
            <td>
              <input
                type="color"
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent"
                value={draft.color}
                aria-label="Colour"
                onChange={(e) => setField('color', e.target.value)}
              />
            </td>
            <td>
              <NativeSelectField
                value={draft.category}
                ariaLabel="Category"
                options={[
                  { value: 'LEAVE', label: 'Leave' },
                  { value: 'SICKNESS', label: 'Sickness' },
                  { value: 'OTHER', label: 'Other' },
                ]}
                onChange={(v) => setField('category', v)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.blocksAssignment}
                aria-label="Blocks assignment"
                onChange={(e) => setField('blocksAssignment', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.countsTowardCapacity}
                aria-label="Counts toward capacity"
                onChange={(e) => setField('countsTowardCapacity', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.requiresApproval}
                aria-label="Requires approval"
                onChange={(e) => setField('requiresApproval', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.allowsHalfDay}
                aria-label="Allows half day"
                onChange={(e) => setField('allowsHalfDay', e.target.checked)}
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={draft.isActive}
                aria-label="Active"
                onChange={(e) => setField('isActive', e.target.checked)}
              />
            </td>
            <td>
              <NumberField value={draft.sortOrder} ariaLabel="Sort order" onChange={(v) => setField('sortOrder', v)} />
            </td>
          </>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presence types
// ---------------------------------------------------------------------------
