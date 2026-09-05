/**
 * Settings → Notifications (ADR-0064).
 *
 * Two views of one thing. **Rules** is policy an administrator sets: a grid of kinds
 * against channels. **Log** is evidence nobody sets: what each notification was owed on,
 * and what became of it.
 *
 * The log exists to answer one question — "why did this person not get the email" — and it
 * can only answer it because a skipped delivery is a row with a reason rather than an
 * absence. That is why a channel that is switched off still shows up here, greyed, instead
 * of showing nothing.
 *
 * Nothing sends yet. An enabled cell produces `pending` rows that accumulate, which is the
 * point of shipping this before the dispatcher: the fan-out is watchable before it is
 * capable of leaving the building.
 */

import { useState } from 'react';
import {
  useNotificationLog,
  useNotificationRules,
  useRetryDelivery,
  useSaveNotificationRules,
  type DeliveryStatus,
  type NotificationChannel,
  type NotificationLogEntry,
  type NotificationRule,
  type SkipReason,
} from '../../api/notificationAdmin.ts';
import { ApiError } from '../../api/client.ts';
import { toast } from '../../ui/toasts.ts';

const CHANNELS: ReadonlyArray<{ value: NotificationChannel; label: string }> = [
  { value: 'email', label: 'Email' },
  { value: 'teams', label: 'Teams' },
];

/** Labels only. What kinds exist is the server's answer — the matrix renders whatever
 * rows come back, so a kind added there needs no change here. */
const KIND_LABELS: Record<string, string> = {
  requestSubmitted: 'Request submitted',
  requestApproved: 'Request approved',
  requestRejected: 'Request declined',
  requestApplyFailed: 'Approved but not applied',
  requestSuperseded: 'Request replaced',
  compDayAging: 'Comp day going stale',
  coverageGap: 'Coverage gap',
};

const SKIP_LABELS: Record<SkipReason, string> = {
  channelDisabled: 'channel off',
  noAddress: 'no address',
  userOptedOut: 'opted out',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function NotificationsTab({ canEdit }: { readonly canEdit: boolean }) {
  const [view, setView] = useState<'rules' | 'log'>('rules');

  return (
    <div className="flex flex-col gap-3">
      {/* Bare on the card before this, the same "glued to the corner" defect the Holidays
          import button and the People/Roles filter rows had — every other control row in
          Settings sits in a `.settings-toolbar`, and a lone segmented switch is still a
          control row. */}
      <div className="settings-toolbar">
        <div className="segmented">
          <button
            type="button"
            className="segmented__item"
            data-active={view === 'rules'}
            onClick={() => setView('rules')}
          >
            Rules
          </button>
          <button
            type="button"
            className="segmented__item"
            data-active={view === 'log'}
            onClick={() => setView('log')}
          >
            Log
          </button>
        </div>
      </div>

      {view === 'rules' ? <RulesView canEdit={canEdit} /> : <LogView canEdit={canEdit} />}
    </div>
  );
}

function RulesView({ canEdit }: { readonly canEdit: boolean }) {
  const rules = useNotificationRules();
  const save = useSaveNotificationRules();
  // Local until Save: an administrator ticks several cells for one intent, and a write per
  // checkbox would be one history row each for a decision that was made once.
  const [draft, setDraft] = useState<readonly NotificationRule[] | null>(null);

  const rows = draft ?? rules.data ?? [];
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const dirty = draft !== null;

  const set = (kind: string, channel: NotificationChannel, patch: Partial<NotificationRule>) => {
    setDraft(
      rows.map((r) => (r.kind === kind && r.channel === channel ? { ...r, ...patch } : r)),
    );
  };

  const cell = (kind: string, channel: NotificationChannel) =>
    rows.find((r) => r.kind === kind && r.channel === channel);

  if (rules.isLoading) return <p className="p-4 text-[12px] text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[70ch] text-[12px] text-muted">
        Which events leave the product, and on which channel. The in-app bell is not listed:
        it is where a notification lives, not somewhere it is sent, so it cannot be switched
        off. <strong>Nothing is delivered yet</strong> — an enabled cell records that the
        message is owed, and the log shows it waiting.
      </p>

      <div className="overflow-x-auto">
        <table className="rows text-[12px]">
          <thead>
            <tr>
              <th className="text-left">Event</th>
              {CHANNELS.map((c) => (
                <th key={c.value} className="text-left">
                  {c.label}
                </th>
              ))}
              <th className="text-left" title="Whether a person may switch this off for themselves">
                People may opt out
              </th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => (
              <tr key={kind}>
                <td>{kindLabel(kind)}</td>
                {CHANNELS.map((c) => (
                  <td key={c.value}>
                    <input
                      type="checkbox"
                      aria-label={`${kindLabel(kind)} on ${c.label}`}
                      disabled={!canEdit}
                      checked={cell(kind, c.value)?.enabled ?? false}
                      onChange={(e) => set(kind, c.value, { enabled: e.target.checked })}
                    />
                  </td>
                ))}
                <td>
                  <input
                    type="checkbox"
                    aria-label={`People may opt out of ${kindLabel(kind)}`}
                    disabled={!canEdit}
                    checked={CHANNELS.every((c) => cell(kind, c.value)?.userOverridable ?? false)}
                    onChange={(e) => {
                      // Opting out is a property of the event, not of one channel: nobody
                      // wants "you may skip the email but not the Teams message".
                      setDraft(
                        rows.map((r) =>
                          r.kind === kind ? { ...r, userOverridable: e.target.checked } : r,
                        ),
                      );
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(rows, {
                onSuccess: () => {
                  setDraft(null);
                  toast.ok('Notification rules saved.');
                },
                onError: (err) =>
                  toast.bad(err instanceof ApiError ? err.message : 'The rules could not be saved.'),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save rules'}
          </button>
          {dirty ? (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDraft(null)}>
              Discard
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-warn">
          What the product sends means the same thing in every unit, so changing it needs a
          global administrator. This is read-only for you.
        </p>
      )}
    </div>
  );
}

function LogView({ canEdit }: { readonly canEdit: boolean }) {
  const [status, setStatus] = useState<string>('');
  const [channel, setChannel] = useState<string>('');
  const [kind, setKind] = useState<string>('');
  const log = useNotificationLog({
    ...(status ? { status } : {}),
    ...(channel ? { channel } : {}),
    ...(kind ? { kind } : {}),
    take: 100,
  });
  const retry = useRetryDelivery();

  return (
    <div className="flex flex-col gap-3">
      <div className="settings-toolbar text-[12px]">
        <select
          className="field py-0.5"
          aria-label="Event"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Every event</option>
          {Object.keys(KIND_LABELS).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          className="field py-0.5"
          aria-label="Channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">Every channel</option>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="field py-0.5"
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any outcome</option>
          <option value="pending">Waiting</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Not sent</option>
        </select>
        {log.data ? (
          <span className="text-faint">
            {log.data.items.length} of {log.data.total}
          </span>
        ) : null}
      </div>

      {log.isLoading ? <p className="p-4 text-[12px] text-muted">Loading…</p> : null}

      {log.data && log.data.items.length === 0 ? (
        <p className="p-4 text-[12px] text-muted">
          Nothing matches. Notifications appear here as they are written — one row per
          person told, with what each channel did about it.
        </p>
      ) : null}

      {log.data && log.data.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="rows text-[12px]">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Who</th>
                <th className="text-left">Event</th>
                <th className="text-left">Message</th>
                <th className="text-left">Channels</th>
              </tr>
            </thead>
            <tbody>
              {log.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-faint">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td>{entry.recipientName ?? entry.recipientPersonId}</td>
                  <td>{kindLabel(entry.kind)}</td>
                  <td className="max-w-[36ch] truncate" title={entry.title}>
                    {entry.title}
                  </td>
                  <td>
                    <Deliveries
                      entry={entry}
                      canEdit={canEdit}
                      onRetry={(id) =>
                        retry.mutate(id, {
                          onSuccess: () => toast.ok('Queued for another attempt.'),
                          onError: (err) =>
                            toast.bad(
                              err instanceof ApiError ? err.message : 'Could not retry that delivery.',
                            ),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const STATUS_TONE: Record<DeliveryStatus, string> = {
  pending: 'text-muted',
  sent: 'text-ok',
  failed: 'text-bad',
  skipped: 'text-faint',
};

function Deliveries({
  entry,
  canEdit,
  onRetry,
}: {
  readonly entry: NotificationLogEntry;
  readonly canEdit: boolean;
  readonly onRetry: (deliveryId: string) => void;
}) {
  if (entry.deliveries.length === 0) {
    // No delivery rows at all means the matrix had nothing to say when this happened —
    // the inbox and nothing else, which is what every notification is until a cell is
    // ticked.
    return <span className="text-faint">in-app only</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {entry.deliveries.map((d) => (
        <span key={d.id} className={`inline-flex items-center gap-1 ${STATUS_TONE[d.status]}`}>
          <span className="font-medium">{d.channel}</span>
          <span>
            {d.status === 'skipped' && d.skipReason
              ? `not sent — ${SKIP_LABELS[d.skipReason]}`
              : d.status === 'pending'
                ? 'waiting'
                : d.status}
          </span>
          {d.attempts > 0 ? <span className="text-faint">×{d.attempts}</span> : null}
          {d.lastError ? (
            <span className="text-faint" title={d.lastError}>
              ⚠
            </span>
          ) : null}
          {d.status === 'failed' && canEdit ? (
            <button type="button" className="btn btn--sm" onClick={() => onRetry(d.id)}>
              Retry
            </button>
          ) : null}
        </span>
      ))}
    </span>
  );
}
