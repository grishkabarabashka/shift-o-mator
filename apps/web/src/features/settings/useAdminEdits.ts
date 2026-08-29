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
    for (const [mapKey, entry] of pending) {
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
        if (error instanceof AdminValidationError) nextErrors.set(mapKey, error.fieldErrors);
        else throw error;
      }
    }
    setPending((prev) => {
      const next = new Map(prev);
      for (const key of succeeded) next.delete(key);
      return next;
    });
    setErrors(nextErrors);
    setSaving(false);
    return { ok: nextErrors.size === 0, failedCount: nextErrors.size };
  }

  return {
    dirtyCount,
    saving,
    draftOf,
    isDirty,
    isMarkedForDelete,
    fieldErrorsFor,
    setField,
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
