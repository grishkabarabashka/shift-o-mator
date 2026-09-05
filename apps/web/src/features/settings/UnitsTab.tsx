import { useId } from 'react';
import { type PlanningUnit, type Weekday } from '../../domain/types.ts';
import { CheckboxField, FieldErrorList, NativeSelectField, NumberField, TextField } from './fields.tsx';
import { type Reference, type Edits, EditableTable, WeekdaysEditor } from './shared.tsx';

const DEFAULT_COMP_OFF = {
  windowBeforeDays: 14,
  windowAfterDays: 14,
  excludedWeekdays: [1, 5] as Weekday[],
  agingThresholdDays: 14,
  requiresApprovalWhenNoSlot: true,
};

export function UnitsTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  return (
    <EditableTable
      title="unit"
      rows={reference.units}
      entity="unit"
      edits={edits}
      newTempId={tempId}
      newInitial={{
        name: '',
        kind: 'CROSS_REGION',
        groupBy: 'LOCATION',
        primaryLocationId: reference.locations[0]?.id ?? '',
        locationIds: reference.locations[0] ? [reference.locations[0].id] : [],
        compOffPolicy: DEFAULT_COMP_OFF,
      }}
      renderHeader={() => (
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Group by</th>
          <th>Primary location</th>
          <th>Member locations</th>
          <th title="How far either side of the worked weekend a comp day may be placed">
            Comp-off before / after
          </th>
          <th title="Weekdays a comp day is never placed on">Never on</th>
          <th>Aging threshold</th>
          <th title="No free slot in the window: raise it for approval rather than dropping it">
            Approve when no slot
          </th>
          <th />
        </tr>
      )}
      renderRow={(draft: PlanningUnit, setField, errors) => (
        <>
          <td>
            <TextField value={draft.name} ariaLabel="Name" onChange={(v) => setField('name', v)} />
            <FieldErrorList errors={errors?.name} />
          </td>
          <td>
            <NativeSelectField
              value={draft.kind}
              ariaLabel="Kind"
              options={[{ value: 'REGION', label: 'Region' }, { value: 'CROSS_REGION', label: 'Cross-region' }]}
              onChange={(v) => setField('kind', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.groupBy}
              ariaLabel="Group by"
              options={[
                { value: 'LOCATION', label: 'Location' },
                { value: 'REGION', label: 'Region (legacy — no data uses this)' },
                { value: 'ORG_CATEGORY', label: 'Org category' },
              ]}
              onChange={(v) => setField('groupBy', v)}
            />
          </td>
          <td>
            <NativeSelectField
              value={draft.primaryLocationId}
              ariaLabel="Primary location"
              options={reference.locations.map((l) => ({ value: l.id, label: l.name }))}
              onChange={(v) => setField('primaryLocationId', v)}
            />
            <FieldErrorList errors={errors?.primaryLocationId} />
          </td>
          <td className="flex max-w-[220px] flex-wrap gap-2">
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
            <FieldErrorList errors={errors?.locationIds} />
          </td>
          <td className="flex items-center gap-1.5">
            <NumberField
              value={draft.compOffPolicy.windowBeforeDays}
              ariaLabel="Comp-off window before"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, windowBeforeDays: v })}
            />
            <span className="text-faint">/</span>
            <NumberField
              value={draft.compOffPolicy.windowAfterDays}
              ariaLabel="Comp-off window after"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, windowAfterDays: v })}
            />
            <span className="text-faint">days</span>
          </td>
          <td>
            {/* Mon and Fri by default, and stored per unit — but there was no control, so
                the one part of the comp-off search a team actually argues about needed a
                deployment. */}
            <WeekdaysEditor
              value={draft.compOffPolicy.excludedWeekdays}
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, excludedWeekdays: v })}
            />
          </td>
          <td>
            <NumberField
              value={draft.compOffPolicy.agingThresholdDays}
              ariaLabel="Comp-off aging threshold"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, agingThresholdDays: v })}
            />
            <span className="ml-1 text-faint">days</span>
          </td>
          <td>
            <CheckboxField
              checked={draft.compOffPolicy.requiresApprovalWhenNoSlot}
              ariaLabel="Requires approval when no slot"
              onChange={(v) => setField('compOffPolicy', { ...draft.compOffPolicy, requiresApprovalWhenNoSlot: v })}
            />
          </td>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Absence capacity rules
// ---------------------------------------------------------------------------
