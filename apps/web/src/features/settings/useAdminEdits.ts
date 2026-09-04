/**
 * Single dirty-bar state for the whole Settings screen (Phase 6). Mirrors the
 * interaction shape `hasDraftChanges`/the draft banner already use for the
 * planning grid (`useSchedule.ts`, `AppShell.tsx`) — a persistent "N unsaved"
 * indicator with Save All / Cancel — but this is a separate mechanism:
 * admin edits are not schedule drafts (they never touch `DraftSession`).
 *
 * Design: every field an editable row shows is *derived*, not duplicated —
 * `draftOf(entity, id, serverValue)` returns the pending patch merged over the
 * server value if one exists, otherwise the server value itself. Typing in a
 * field just writes into `pending`; nothing hits the network until `saveAll`.
 * `cancelAll` is therefore just "clear the map" — every input re-renders back
 * to its server value with no per-row reset logic needed.
 */

import { useCallback, useMemo, useState } from 'react';
import { AdminValidationError, type FieldErrors } from '../../api/admin.ts';

export type AdminEntity =
  | 'location'
  | 'holiday'
  | 'shift'
  | 'unit'
  | 'absenceCapacityRule'
  | 'eventType'
  | 'presenceType'
  | 'person';

type PendingOp =
  | { readonly kind: 'update'; readonly id: string; readonly patch: Record<string, unknown> }
  | { readonly kind: 'create'; readonly tempId: string; readonly patch: Record<string, unknown> }
  | { readonly kind: 'delete'; readonly id: string };

function keyOf(entity: AdminEntity, id: string): string {
  return `${entity}:${id}`;
}

export interface EntityOps<TDomain extends { readonly id: string }, TRequest> {
  create: (request: TRequest) => Promise<unknown>;
  update: (id: string, request: TRequest) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  toRequest: (draft: Partial<TDomain>) => TRequest;
  /**
   * Optional: send every pending op for this entity as one atomic request instead of one
   * per row. Provide it when rows of this entity are *not* independent — people are, via
   * the unique indexes on `email` and `employeeId`, so moving an address between two of
   * them is two writes that are only valid together (ADR-0061).
   *
   * Rejections come back keyed by the op's index in what was sent, and nothing was
   * applied. Entities without this keep the row-at-a-time path, which is fine for them:
   * a location and another location cannot invalidate each other.
   */
  saveBatch?: (ops: readonly BatchOp[]) => Promise<void>;
}

/** One op as `saveBatch` receives it — the caller maps this onto its own wire shape. */
export interface BatchOp {
  readonly kind: 'create' | 'update' | 'delete';
  readonly id?: string;
  readonly tempId?: string;
  readonly request?: unknown;
}

/** Thrown by a `saveBatch` implementation to report per-op field errors. */
export class BatchRejected extends Error {
  constructor(readonly byIndex: ReadonlyMap<number, FieldErrors>) {
    super('The changes were rejected and nothing was saved.');
    this.name = 'BatchRejected';
  }
}

export function useAdminEdits() {
  const [pending, setPending] = useState<Map<string, { entity: AdminEntity; op: PendingOp }>>(new Map());
  const [errors, setErrors] = useState<Map<string, FieldErrors>>(new Map());
  const [saving, setSaving] = useState(false);

  const dirtyCount = pending.size;

  const draftOf = useCallback(
    <T extends object>(entity: AdminEntity, id: string, server: T): T => {
      const entry = pending.get(keyOf(entity, id));
      if (!entry || entry.op.kind === 'delete') return server;
      return { ...server, ...entry.op.patch } as T;
    },
    [pending],
  );

  const isDirty = useCallback((entity: AdminEntity, id: string) => pending.has(keyOf(entity, id)), [pending]);

  /**
   * Unsaved rows and rejected rows per entity, for the tab strip.
   *
   * WHY: the dirty bar counts the whole screen and the save toast says "see the
   * highlighted fields" — but the highlighted field is often on a tab that is not the
   * one being looked at, and nothing said which.
   */
  const countsByEntity = useMemo(() => {
    const dirty = new Map<AdminEntity, number>();
    const failed = new Map<AdminEntity, number>();
    for (const [key, entry] of pending) {
      dirty.set(entry.entity, (dirty.get(entry.entity) ?? 0) + 1);
      if (errors.has(key)) failed.set(entry.entity, (failed.get(entry.entity) ?? 0) + 1);
    }
    return { dirty, failed };
  }, [pending, errors]);
  const isMarkedForDelete = useCallback(
    (entity: AdminEntity, id: string) => pending.get(keyOf(entity, id))?.op.kind === 'delete',
    [pending],
  );
  const fieldErrorsFor = useCallback((entity: AdminEntity, id: string) => errors.get(keyOf(entity, id)), [errors]);

  /**
   * `base` is the row as currently *displayed* (i.e. `draftOf`'s own return
   * value — server merged with any prior edit this session). The patch is
   * always stored as a full merged object, not an incremental delta: that's
   * what lets `saveAll` call `toRequest(patch)` directly without needing to
   * re-fetch and re-merge the original row at save time.
   */
  const setField = useCallback((entity: AdminEntity, id: string, field: string, value: unknown, base: object) => {
    setPending((prev) => {
      const next = new Map(prev);
      const key = keyOf(entity, id);
      next.set(key, { entity, op: { kind: 'update', id, patch: { ...base, [field]: value } } });
      return next;
    });
  }, []);

  /**
   * Several fields at once, against one `base`.
   *
   * WHY this exists rather than calling `setField` twice: `base` is captured at render,
   * so the second call overwrites the first with a patch built from the *stale* row. Two
   * fields that only make sense together — a rule's unit and the shift pool inside it —
   * have to travel as one patch.
   */
  const setFields = useCallback((entity: AdminEntity, id: string, patch: Record<string, unknown>, base: object) => {
    setPending((prev) => {
      const next = new Map(prev);
      const key = keyOf(entity, id);
      const existing = next.get(key);
      if (existing?.op.kind === 'create') {
        next.set(key, { entity, op: { kind: 'create', tempId: existing.op.tempId, patch: { ...existing.op.patch, ...patch } } });
      } else {
        next.set(key, { entity, op: { kind: 'update', id, patch: { ...base, ...patch } } });
      }
      return next;
    });
  }, []);

  const startCreate = useCallback((entity: AdminEntity, tempId: string, initial: Record<string, unknown>) => {
    setPending((prev) => {
      const next = new Map(prev);
      next.set(keyOf(entity, `new:${tempId}`), { entity, op: { kind: 'create', tempId, patch: initial } });
      return next;
    });
  }, []);

  const setCreateField = useCallback((entity: AdminEntity, tempId: string, field: string, value: unknown) => {
    setPending((prev) => {
      const next = new Map(prev);
      const key = keyOf(entity, `new:${tempId}`);
      const existing = next.get(key);
      if (!existing || existing.op.kind !== 'create') return prev;
      next.set(key, { entity, op: { kind: 'create', tempId, patch: { ...existing.op.patch, [field]: value } } });
      return next;
    });
  }, []);

  const markDelete = useCallback((entity: AdminEntity, id: string) => {
    setPending((prev) => {
      const next = new Map(prev);
      next.set(keyOf(entity, id), { entity, op: { kind: 'delete', id } });
      return next;
    });
  }, []);

  const discardOne = useCallback((entity: AdminEntity, id: string) => {
    setPending((prev) => {
      const next = new Map(prev);
      next.delete(keyOf(entity, id));
      return next;
    });
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(keyOf(entity, id));
      return next;
    });
  }, []);

  const cancelAll = useCallback(() => {
    setPending(new Map());
    setErrors(new Map());
  }, []);

  const pendingCreates = useMemo(
    () =>
      [...pending.entries()]
        .filter((e): e is [string, { entity: AdminEntity; op: Extract<PendingOp, { kind: 'create' }> }] =>
          e[1].op.kind === 'create',
        )
        .map(([mapKey, e]) => ({ mapKey, entity: e.entity, tempId: e.op.tempId, patch: e.op.patch })),
    [pending],
  );

  async function saveAll(opsByEntity: Partial<Record<AdminEntity, EntityOps<never, never>>>) {
    setSaving(true);
    const nextErrors = new Map<string, FieldErrors>();
    const succeeded: string[] = [];
    // Anything that is not a per-field rejection: a 500, a dropped connection, a bug. It is
    // returned rather than thrown (see below), so the caller can say so.
    let failure: string | undefined;

    // Entities that can be sent atomically go first and go whole: their rows interact,
    // so applying some of them is worse than applying none (ADR-0061).
    const batched = new Set<AdminEntity>();
    for (const entry of pending.values()) {
      if (opsByEntity[entry.entity]?.saveBatch) batched.add(entry.entity);
    }

    try {
      for (const entity of batched) {
        const ops = opsByEntity[entity]!;
        const entries = [...pending.entries()].filter(([, e]) => e.entity === entity);
        const batch: BatchOp[] = entries.map(([, e]) =>
          e.op.kind === 'delete'
            ? { kind: 'delete', id: e.op.id }
            : e.op.kind === 'update'
              ? { kind: 'update', id: e.op.id, request: ops.toRequest(e.op.patch as never) }
              : { kind: 'create', tempId: e.op.tempId, request: ops.toRequest(e.op.patch as never) },
        );

        try {
          await ops.saveBatch!(batch);
          for (const [mapKey] of entries) succeeded.push(mapKey);
        } catch (error) {
          if (error instanceof BatchRejected) {
            // Nothing was applied, so every row stays dirty — including the ones that were
            // individually fine. That is the contract, and saying otherwise would invite
            // somebody to close the screen believing half of it saved.
            for (const [index, fields] of error.byIndex) {
              const key = entries[index]?.[0];
              if (key) nextErrors.set(key, fields);
            }
            continue;
          }
          failure = error instanceof Error ? error.message : 'The change could not be saved.';
          break;
        }
      }

      for (const [mapKey, entry] of pending) {
        if (failure !== undefined) break;
        if (batched.has(entry.entity)) continue;
        const ops = opsByEntity[entry.entity];
        if (!ops) continue;
        try {
          if (entry.op.kind === 'update') {
            await ops.update(entry.op.id, ops.toRequest(entry.op.patch as never));
          } else if (entry.op.kind === 'create') {
            await ops.create(ops.toRequest(entry.op.patch as never));
          } else {
            await ops.remove(entry.op.id);
          }
          succeeded.push(mapKey);
        } catch (error) {
          if (error instanceof AdminValidationError) {
            nextErrors.set(mapKey, error.fieldErrors);
            continue;
          }
          // WHY this no longer rethrows: it was thrown out of an async click handler, where
          // nothing catches it — React's boundaries do not see rejected promises. The
          // result was an unhandled rejection and a button stuck on "Saving…" forever,
          // because the `setSaving(false)` below was never reached. Stop at the first such
          // failure: if the API is down, the remaining rows will fail the same way, and
          // twenty identical errors is not more information than one.
          failure = error instanceof Error ? error.message : 'The change could not be saved.';
          break;
        }
      }

      setPending((prev) => {
        const next = new Map(prev);
        for (const key of succeeded) next.delete(key);
        return next;
      });
      setErrors(nextErrors);

      return {
        ok: nextErrors.size === 0 && failure === undefined,
        savedCount: succeeded.length,
        failedCount: nextErrors.size,
        ...(failure ? { failure } : {}),
      };
    } finally {
      // In a `finally` so the button comes back even if something above throws anyway.
      setSaving(false);
    }
  }

  return {
    dirtyCount,
    saving,
    draftOf,
    isDirty,
    countsByEntity,
    isMarkedForDelete,
    fieldErrorsFor,
    setField,
    setFields,
    startCreate,
    setCreateField,
    pendingCreates,
    markDelete,
    discardOne,
    cancelAll,
    saveAll,
  };
}

export type UseAdminEdits = ReturnType<typeof useAdminEdits>;
