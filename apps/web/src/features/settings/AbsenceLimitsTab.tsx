import { useId } from 'react';
import { type AbsenceCapacityRule } from '../../domain/types.ts';
import { CheckboxField, FieldErrorList, NativeSelectField, NumberField } from './fields.tsx';
import { type Reference, type Edits, EditableTable } from './shared.tsx';

export function AbsenceLimitsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  // The kinds of leave a rule counts by default: whatever an administrator has already
  // said counts against capacity. Hardcoding a list of codes here was how this row came
  // to carry `countsTypes` — a field no layer below it has ever known about.
  const countedByDefault = reference.eventTypes
    .filter((t) => t.isActive && t.countsTowardCapacity)
    .map((t) => t.id);
  const activeEventTypes = [...reference.eventTypes]
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <EditableTable
      title="rule"
      rows={reference.absenceCapacityRules}
      entity="absenceCapacityRule"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        unitId: reference.units[0]?.id ?? '',
        scope: { kind: 'UNIT' },
        durationBucket: 'SHORT',
        longThresholdWorkdays: 5,
        maxConcurrent: 1,
        countsEventTypeIds: countedByDefault,
        countsCompDays: false,
      }}
      renderHeader={() => (
        <tr>
          <th>Unit</th>
          <th>Scope</th>
          <th>Duration</th>
          <th title="How many workdays of leave make an absence “long”">Long from</th>
          <th>Max concurrent</th>
          <th title="Which kinds of leave this limit counts. A kind nothing counts is unlimited.">
            Counts
          </th>
          <th>Counts comp days</th>
          <th />
        </tr>
      )}
      renderRow={(draft: AbsenceCapacityRule, setField, errors) => (
        <>
          <td>
            <NativeSelectField
              value={draft.unitId}
              ariaLabel="Unit"
              options={reference.units.map((u) => ({ value: u.id, label: u.name }))}
              onChange={(v) => {
                setField('unitId', v);
                // Moving the rule takes its pool with it, and the old unit's shift is not in
                // the new unit — leaving it there is a row the server rejects on save.
                if (draft.scope.kind === 'SHIFT_POOL') {
                  setField('scope', { kind: 'SHIFT_POOL', shiftId: reference.shifts.find((s) => s.unitId === v)?.id ?? '' });
                }
              }}
            />
          </td>
          <td className="flex items-center gap-1">
            <NativeSelectField
              value={draft.scope.kind}
              ariaLabel="Scope"
              options={[{ value: 'UNIT', label: 'Unit-wide' }, { value: 'SHIFT_POOL', label: 'Shift pool' }]}
              onChange={(v) =>
                setField(
                  'scope',
                  v === 'SHIFT_POOL'
                    ? // The pool has to belong to the rule's own unit. This used to reach for
                      // `shifts[0]`, which is whatever unit happens to sort first — a rule
                      // limiting an EMEA pool from an APAC row, rejected only by the server.
                      { kind: 'SHIFT_POOL', shiftId: reference.shifts.find((s) => s.unitId === draft.unitId)?.id ?? '' }
                    : { kind: 'UNIT' },
                )
              }
            />
            {draft.scope.kind === 'SHIFT_POOL' ? (
              <NativeSelectField
                value={draft.scope.shiftId}
                ariaLabel="Shift pool"
                options={reference.shifts.filter((s) => s.unitId === draft.unitId).map((s) => ({ value: s.id, label: s.code }))}
                onChange={(v) => setField('scope', { kind: 'SHIFT_POOL', shiftId: v })}
              />
            ) : null}
            <FieldErrorList errors={errors?.scopeShiftId} />
          </td>
          <td>
            <NativeSelectField
              value={draft.durationBucket}
              ariaLabel="Duration bucket"
              options={[{ value: 'SHORT', label: 'Short' }, { value: 'LONG', label: 'Long' }]}
              onChange={(v) => setField('durationBucket', v)}
            />
          </td>
          <td>
            {/* The boundary between the two buckets. It was stored, used by the engine and
                editable nowhere, so "3 long / 4 short" was a rule whose "long" nobody could
                read off the screen. */}
            <NumberField
              min={0}
              value={draft.longThresholdWorkdays}
              ariaLabel="Long from, workdays"
              onChange={(v) => setField('longThresholdWorkdays', v)}
            />
            <span className="ml-1 text-faint">workdays</span>
            <FieldErrorList errors={errors?.longThresholdWorkdays} />
          </td>
          <td>
            <NumberField min={0} value={draft.maxConcurrent} ariaLabel="Max concurrent" onChange={(v) => setField('maxConcurrent', v)} />
            <FieldErrorList errors={errors?.maxConcurrent} />
          </td>
          <td className="flex max-w-[260px] flex-wrap gap-x-2 gap-y-0.5">
            {activeEventTypes.map((type) => (
              <label key={type.id} className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={draft.countsEventTypeIds.includes(type.id)}
                  onChange={(e) =>
                    setField(
                      'countsEventTypeIds',
                      e.target.checked
                        ? [...draft.countsEventTypeIds, type.id]
                        : draft.countsEventTypeIds.filter((id) => id !== type.id),
                    )
                  }
                />
                {type.shortLabel || type.label}
              </label>
            ))}
          </td>
          <td>
            <CheckboxField checked={draft.countsCompDays} ariaLabel="Counts comp days" onChange={(v) => setField('countsCompDays', v)} />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// People — identity fields only (eligibility/preferences: People page)
// ---------------------------------------------------------------------------
