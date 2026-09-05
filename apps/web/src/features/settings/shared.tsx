import { type ReactElement } from 'react';
import { type ReferenceData, type Weekday } from '../../domain/types.ts';
import { type AdminEntity, useAdminEdits } from './useAdminEdits.ts';
import { useCapabilities } from '../../auth/useCapabilities.ts';
import { useRoleAssignments } from '../../api/roleAssignments.ts';

export type Reference = ReferenceData;

export type Edits = ReturnType<typeof useAdminEdits>;

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export function EditableTable<T extends { readonly id: string }>({
  title,
  rows,
  entity,
  edits,
  newTempId,
  newInitial,
  renderHeader,
  renderRow,
  showDelete = true,
}: {
  readonly title: string;
  readonly rows: readonly T[];
  readonly entity: AdminEntity;
  readonly edits: Edits;
  readonly newTempId: string;
  readonly newInitial: Record<string, unknown>;
  readonly renderHeader: () => ReactElement;
  /**
   * False for an entity with no real delete — `eventType`, whose endpoint has no DELETE
   * on purpose (ADR-0049: absences point at these by id). The button used to render
   * anyway: clicking it dimmed the row, "Save all" called a `remove` stub that resolved
   * successfully, and the row came back at full opacity on the next refetch, unchanged —
   * a control that looked like it worked and did nothing. `isActive` is the real
   * retirement switch for these rows, and it is already a column in the table.
   */
  readonly showDelete?: boolean;
  readonly renderRow: (
    draft: T,
    setField: (field: string, value: unknown) => void,
    errors: ReturnType<Edits['fieldErrorsFor']>,
    /** Two fields that are only valid together — see `useAdminEdits.setFields`. */
    setFields: (patch: Record<string, unknown>) => void,
  ) => ReactElement;
}) {
  // The pending row as typed so far. It used to render from `newInitial` — a fresh object
  // literal every render — so every keystroke in a new row was written to `pending` and
  // then immediately painted back over with the initial value: a controlled input nobody
  // could type into, on every tab's "+ New" row.
  const creatingDraft = edits.pendingCreates.find((c) => c.entity === entity && c.tempId === newTempId)?.patch;
  const creating = creatingDraft !== undefined;

  return (
    <table className="rows">
      <thead>{renderHeader()}</thead>
      <tbody>
        {rows.length === 0 && !creatingDraft ? (
          <tr>
            <td colSpan={20} className="text-[12px] text-faint">
              Nothing here yet — “+ New {title}” below.
            </td>
          </tr>
        ) : null}
        {rows.map((row) => {
          const draft = edits.draftOf(entity, row.id, row as unknown as Record<string, unknown>) as unknown as T;
          const markedForDelete = edits.isMarkedForDelete(entity, row.id);
          const errors = edits.fieldErrorsFor(entity, row.id);
          // `isDirty` existed and was called by nothing: an edited row looked exactly like
          // an untouched one, so "5 unsaved changes" was a number with no rows attached.
          const dirty = edits.isDirty(entity, row.id);
          return (
            <tr
              key={row.id}
              className={markedForDelete ? 'opacity-40' : undefined}
              data-dirty={dirty && !markedForDelete ? true : undefined}
              data-rejected={errors ? true : undefined}
            >
              {renderRow(
                draft,
                (field, value) => edits.setField(entity, row.id, field, value, draft as unknown as Record<string, unknown>),
                errors,
                (patch) => edits.setFields(entity, row.id, patch, draft as unknown as Record<string, unknown>),
              )}
              <td>
                {!showDelete ? null : markedForDelete ? (
                  <button type="button" className="btn btn--sm" onClick={() => edits.discardOne(entity, row.id)}>
                    Undo delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost text-bad"
                    title={`Mark this ${title} for deletion — applied on Save all, undoable until then`}
                    onClick={() => edits.markDelete(entity, row.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          );
        })}

        {creatingDraft ? (
          <tr>
            {renderRow(
              creatingDraft as unknown as T,
              (field, value) => edits.setCreateField(entity, newTempId, field, value),
              edits.fieldErrorsFor(entity, `new:${newTempId}`),
              (patch) => edits.setFields(entity, `new:${newTempId}`, patch, creatingDraft),
            )}
            <td>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => edits.discardOne(entity, `new:${newTempId}`)}>
                Discard
              </button>
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={20}>
            {!creating ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => edits.startCreate(entity, newTempId, newInitial)}
              >
                + New {title}
              </button>
            ) : null}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Who may plan, approve and administer, and where (ADR-0051).
 *
 * WHY a matrix of people against roles rather than a list of grants: the question people
 * actually arrive with is "who approves EMEA's leave", and a flat list of rows sorted by
 * whatever the database returned does not answer it. The unit filter comes first because
 * a grant means nothing without it.
 *
 * Viewer is absent on purpose: everyone signed in has it, and a checkbox that can only
 * ever be ticked is a lie about what is configurable.
 */

/**
 * "This is read-only for you" — and **who to ask**.
 *
 * WHY the names: the previous version stated the rule and stopped there, so the reader
 * was told a global administrator exists and given no way to find one. There is nothing
 * else in the product that answers it either; the seed creates exactly one, and hunting
 * for them meant acting as people one at a time in the dev switcher.
 *
 * Reading grants needs no privilege on purpose — "who approves my leave" and "who can
 * change this" are fair questions for the person waiting on the answer.
 */
export function GlobalAdminNotice({ reference, what }: { readonly reference: Reference; readonly what: string }) {
  const caps = useCapabilities();
  const grants = useRoleAssignments();
  if (caps.canAdministerGlobally) return null;

  const names = (grants.data ?? [])
    .filter((g) => g.role.toLowerCase() === 'admin' && !g.unitId)
    .map((g) => reference.people.find((p) => p.id === g.personId)?.displayName ?? g.personId);

  return (
    <p className="text-[12px] text-warn">
      {what} means the same thing in every unit, so changing it needs a global
      administrator. This is read-only for you.{' '}
      {names.length > 0
        ? `Ask ${[...new Set(names)].join(', ')}.`
        : 'Nobody holds that grant — a global admin has to be granted on the Roles tab first.'}
    </p>
  );
}

/** "1 row" / "2 rows" — a count with the wrong plural beside it reads as a bug. */
export function rowWord(count: number): string {
  return count === 1 ? 'row' : 'rows';
}

export const WEEKDAY_LABELS: ReadonlyArray<{ value: Weekday; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function WeekdaysEditor({ value, onChange }: { readonly value: readonly Weekday[]; readonly onChange: (v: Weekday[]) => void }) {
  const set = new Set(value);
  return (
    <div className="flex gap-1">
      {WEEKDAY_LABELS.map((d) => (
        <button
          key={d.value}
          type="button"
          className="day-chip"
          data-selected={set.has(d.value)}
          onClick={() => {
            const next = new Set(set);
            if (next.has(d.value)) next.delete(d.value);
            else next.add(d.value);
            onChange([...next].sort((a, b) => a - b));
          }}
        >
          <span className="day-chip__num text-[10.5px]">{d.label}</span>
        </button>
      ))}
    </div>
  );
}
