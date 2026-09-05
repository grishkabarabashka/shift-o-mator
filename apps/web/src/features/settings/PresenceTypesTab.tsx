import { useId } from 'react';
import { type PresenceType } from '../../domain/types.ts';
import { FieldErrorList, NativeSelectField, NumberField, TextField } from './fields.tsx';
import { type Reference, type Edits, EditableTable, GlobalAdminNotice } from './shared.tsx';

/**
 * The "where are you working" options (ADR-0043) — what they are called, how they are
 * drawn, and whether recording one raises a request instead of writing the day.
 *
 * WHY this is not an `EditableTable`: there is no New and no Delete. One row per
 * `PresenceKind`, and the kind is what every record carries, so a fifth row from a screen
 * would be a value nothing downstream understands. Retiring one is Active off, which drops
 * it from the cell menu while existing records keep their colour and their name.
 *
 * The approval column is the one that earns the screen. "Remote needs signing off" used to
 * be an `if` in the cell menu; it is a local policy, and a team that trusts remote days —
 * or one that wants travel signed off — should not need a release.
 */
export function PresenceTypesTab({ reference, edits }: { readonly reference: Reference; readonly edits: Edits }) {
  const tempId = useId();
  const sorted = [...reference.presenceTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted">
        The options on a cell&rsquo;s right-click menu. Presence never affects coverage
        &mdash; somebody remote on <code>Crew</code> still covers <code>Crew</code>.
      </p>
      <GlobalAdminNotice reference={reference} what="Where people work" />

      <EditableTable
        title="way of working"
        rows={sorted}
        entity="presenceType"
        edits={edits}
        newTempId={tempId}
        newInitial={{
          label: '',
          glyph: '',
          color: '#6b7688',
          namesALocation: false,
          countsAs: 'AWAY',
          requiresApproval: false,
          isActive: true,
          sortOrder: sorted.length + 1,
        }}
        renderHeader={() => (
          <tr>
            <th>Label</th>
            <th className="w-[80px]" title="One or two characters — the presence band in a cell is 9px">
              In the cell
            </th>
            <th className="w-[70px]">Colour</th>
            <th className="w-[110px]" title="Recording it picks one of our offices, instead of free text">
              An office
            </th>
            <th className="w-[130px]" title="Which headcount it adds to on the coverage strip">
              Counts as
            </th>
            <th className="w-[100px]" title="Has to be asked for and approved, by anybody — planners included">
              Approval
            </th>
            <th className="w-[70px]" title="Unticking hides it from the menu; existing records keep it">
              Offered
            </th>
            <th className="w-[70px]">Order</th>
            <th />
          </tr>
        )}
        renderRow={(draft: PresenceType, setField, errors) => (
          <>
            <td>
              <TextField value={draft.label} ariaLabel="Label" onChange={(v) => setField('label', v)} />
              <FieldErrorList errors={errors?.label} />
            </td>
            <td>
              <TextField value={draft.glyph} ariaLabel="Glyph" onChange={(v) => setField('glyph', v)} />
              <FieldErrorList errors={errors?.glyph} />
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
              <input
                type="checkbox"
                checked={draft.namesALocation}
                aria-label="Names an office"
                onChange={(e) => setField('namesALocation', e.target.checked)}
              />
            </td>
            <td>
              <NativeSelectField
                value={draft.countsAs}
                ariaLabel="Counts as"
                options={[
                  { value: 'ON_SITE', label: 'On site' },
                  { value: 'REMOTE', label: 'Remote' },
                  { value: 'AWAY', label: 'Away' },
                ]}
                onChange={(v) => setField('countsAs', v)}
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
                checked={draft.isActive}
                aria-label="Offered"
                onChange={(e) => setField('isActive', e.target.checked)}
              />
            </td>
            <td>
              <NumberField
                value={draft.sortOrder}
                ariaLabel="Sort order"
                onChange={(v) => setField('sortOrder', v)}
              />
            </td>
          </>
        )}
      />
    </div>
  );
}
