/**
 * Persistent unsaved-changes bar for Settings — same visual language as the
 * draft pill in `AppShell.tsx` (`pill--warn` while dirty), but this is a
 * distinct save mechanism: admin edits never touch `DraftSession` (ADR-0015
 * is about the schedule; this is reference data).
 */
export function DirtyBar({
  dirtyCount,
  saving,
  onSaveAll,
  onCancelAll,
}: {
  readonly dirtyCount: number;
  readonly saving: boolean;
  readonly onSaveAll: () => void;
  readonly onCancelAll: () => void;
}) {
  if (dirtyCount === 0) return null;

  return (
    <div className="card sticky top-2 z-10 flex items-center gap-3 border-[var(--warn)] px-3 py-2">
      <span className="pill pill--warn">
        {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className="btn btn--sm" disabled={saving} onClick={onCancelAll}>
          Cancel
        </button>
        <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={onSaveAll}>
          {saving ? 'Saving…' : 'Save all'}
        </button>
      </div>
    </div>
  );
}
