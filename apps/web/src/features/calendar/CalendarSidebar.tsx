/**
 * What a person actually wants to know beside their own calendar: the days they have
 * earned, what they have asked for, and how to get all of this into Outlook.
 *
 * The comp-day list earns its place. A comp day is accrued by publishing and *placed* by
 * the person taking it (ADR-0052), so an unplaced one has no date and appears nowhere on a
 * calendar — which is precisely the thing that needs chasing.
 */

import { useState } from 'react';
import { useMyCalendarFeed, useResetCalendarFeed, type MyPendingRequest } from '../../api/myCalendar.ts';
import { effectiveCompDayDate, type CompDayEntry, type PersonId } from '../../domain/types.ts';
import { useUi } from '../../store/useUi.ts';

export function CalendarSidebar({
  compDays,
  pending,
  personId,
}: {
  readonly compDays: readonly CompDayEntry[];
  readonly pending: readonly MyPendingRequest[];
  readonly personId: PersonId;
}) {
  const openCompDayDialog = useUi((s) => s.openCompDayDialog);
  const outstanding = compDays.filter((entry) => entry.status !== 'TAKEN' && entry.status !== 'DECLINED');

  return (
    <aside className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto">
      <section className="card p-3">
        <h2 className="mb-2 text-[12.5px] font-semibold">Comp days</h2>
        {outstanding.length === 0 ? (
          <p className="text-[11.5px] text-faint">Nothing outstanding.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {outstanding.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => openCompDayDialog(entry)}
                >
                  <span className="block text-[12px]">
                    {entry.status === 'SCHEDULED'
                      ? `Booked for ${effectiveCompDayDate(entry)}`
                      : entry.status === 'PENDING_APPROVAL'
                        ? 'Awaiting approval'
                        : `Suggested ${effectiveCompDayDate(entry) ?? '—'}`}
                  </span>
                  <span className="block text-[10.5px] text-faint">
                    Earned for {entry.earnedForDate}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-3">
        <h2 className="mb-2 text-[12.5px] font-semibold">Waiting on a decision</h2>
        {pending.length === 0 ? (
          <p className="text-[11.5px] text-faint">Nothing pending.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pending.map((request) => (
              <li key={request.id} className="text-[12px]">
                <span className="block">{request.typeLabel}</span>
                <span className="block text-[10.5px] text-faint">
                  {request.from === request.to ? request.from : `${request.from} → ${request.to}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SubscribeCard personId={personId} />
    </aside>
  );
}

/**
 * The subscription address, and the button that revokes it.
 *
 * WHY the reset is here rather than in Settings: the URL is a credential, this is the only
 * place it is ever shown, and "I put that link in a shared document" is a thing that
 * happens the same day somebody learns the feature exists.
 */
function SubscribeCard({ personId }: { readonly personId: PersonId }) {
  const feed = useMyCalendarFeed();
  const reset = useResetCalendarFeed();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  void personId;

  const url = feed.data?.url;

  return (
    <section className="card p-3">
      <h2 className="mb-1 text-[12.5px] font-semibold">In your own calendar</h2>
      <p className="mb-2 text-[11px] text-muted">
        Subscribe in Outlook or Google and your shifts, leave and comp days appear there,
        refreshed on their schedule. Anyone with this address can read them, so treat it
        like a password.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!url}
          onClick={() => {
            if (!url) return;
            void navigator.clipboard?.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy address'}
        </button>
        {url ? (
          <a
            className="btn btn--sm"
            // webcal: is what makes a desktop client offer to subscribe rather than
            // download the file once — a downloaded .ics never updates again.
            href={url.replace(/^https?:/, 'webcal:')}
          >
            Open in Outlook
          </a>
        ) : null}
      </div>

      <div className="mt-2 border-t border-line pt-2">
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-warn">Existing subscriptions will stop.</span>
            <button
              type="button"
              className="btn btn--sm btn--danger"
              disabled={reset.isPending}
              onClick={() => {
                reset.mutate();
                setConfirming(false);
              }}
            >
              Reset
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setConfirming(true)}
            title="Use this if the address has been shared with somebody who should not have it"
          >
            Reset the address
          </button>
        )}
      </div>
    </section>
  );
}
