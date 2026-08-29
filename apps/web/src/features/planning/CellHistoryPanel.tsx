/**
 * Everything that happened to one cell, on one time axis.
 *
 * The question this exists for is not "what changed" — the audit log answers that —
 * but "in what order": was the leave request in before or after the rota was moved,
 * and who got there first. Two lists cannot answer that, so the server merges change
 * history, request submissions and approval decisions into one ordered stream.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { apiGet, qs } from '../../api/client.ts';
import { useUi } from '../../store/useUi.ts';

type CellEventKind =
  | 'assignmentChanged'
  | 'absenceChanged'
  | 'presenceChanged'
  | 'compDayChanged'
  | 'requestSubmitted'
  | 'requestDecided';

interface CellEvent {
  readonly at: string;
  readonly kind: CellEventKind;
  readonly actorId: string;
  readonly actorName?: string | null;
  readonly summary: string;
  readonly comment?: string | null;
}

const KIND_LABEL: Record<CellEventKind, string> = {
  assignmentChanged: 'Schedule',
  absenceChanged: 'Absence',
  presenceChanged: 'Presence',
  compDayChanged: 'Comp day',
  requestSubmitted: 'Request',
  requestDecided: 'Decision',
};

export function CellHistoryPanel() {
  const cell = useUi((s) => s.cellHistory);
  const close = useUi((s) => s.closeCellHistory);

  const query = useQuery({
    queryKey: ['cell-history', cell?.personId ?? 'all', cell?.date],
    queryFn: () =>
      apiGet<{ events: readonly CellEvent[] }>(
        // No personId is the whole day, everybody — which is what a conflict needs.
        `/api/history/cell${qs({ personId: cell?.personId, date: cell?.date })}`,
      ),
    enabled: cell !== undefined,
  });

  if (!cell) return null;

  const events = query.data?.events ?? [];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog__overlay" />
        <Dialog.Content className="dialog w-[min(560px,calc(100vw-32px))]">
          <Dialog.Title className="dialog__title">
            {cell.personId ? 'History' : 'History for this day'}
          </Dialog.Title>
          <p className="mb-3 text-[12.5px] text-faint">
            {cell.date}
            {cell.personId ? '' : ' · everyone'}
          </p>

          {query.isPending ? (
            <p className="text-[12.5px] text-faint">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-[12.5px] text-faint">Nothing has happened here yet.</p>
          ) : (
            <ol className="max-h-[55vh] overflow-y-auto">
              {events.map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  className="border-b border-line py-2 last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                    <span className="pill">{KIND_LABEL[event.kind]}</span>
                    <span>{event.summary}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {formatInstant(event.at)} · {event.actorName ?? event.actorId}
                  </div>
                  {event.comment ? (
                    <div className="mt-0.5 text-[11.5px] text-faint">“{event.comment}”</div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 flex justify-end">
            <button type="button" className="btn btn--sm" onClick={close}>
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Local time, to the minute: ordering is the point, and seconds add noise. */
function formatInstant(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
