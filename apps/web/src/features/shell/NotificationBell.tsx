/**
 * The in-app inbox (ADR-0046).
 *
 * WHY in-app first, and only in-app: this application runs no background work, and the
 * comp-day aging alert the product promised on day one has never been delivered anywhere
 * because there was nothing to deliver it *to*. A table written in the same transaction
 * as the change that caused it, plus a poll, is the smallest thing that stops dropping
 * notifications — and it is the same table an email dispatcher would read later.
 */

import * as Popover from '@radix-ui/react-popover';
import { useNavigate } from 'react-router';
import { useMarkNotificationsRead, useNotifications } from '../../api/requests.ts';

export function NotificationBell() {
  const query = useNotifications();
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();

  const unread = query.data?.unreadCount ?? 0;
  const items = query.data?.items ?? [];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="relative grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-sunken"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <span aria-hidden className="text-[15px] leading-none">
            🔔
          </span>
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 grid min-w-[15px] place-items-center rounded-full bg-bad px-[3px] text-[9px] font-bold leading-[14px] text-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[320px] rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[12.5px] font-semibold">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => markRead.mutate()}
                disabled={markRead.isPending}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            // An unreachable API also produces no items, and "Nothing yet." is a
            // reassuring thing to say about a notification list that failed to load.
            query.isError ? (
              <p role="alert" className="px-1 py-2 text-sm text-bad">
                The inbox could not be loaded.
              </p>
            ) : (
              <p className="px-1 py-2 text-sm text-faint">Nothing yet.</p>
            )
          ) : (
            <ul className="max-h-[50vh] overflow-y-auto">
              {items.slice(0, 20).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded px-1.5 py-1.5 text-left hover:bg-surface-sunken"
                    // Everything the inbox can carry today is about a request; the deep
                    // link stays useful as other subjects appear because it routes on
                    // `subjectType`, not on the notification kind.
                    onClick={() => {
                      if (item.subjectType === 'request') void navigate('/requests');
                    }}
                  >
                    <span className="flex items-baseline gap-1.5">
                      {!item.readAt ? (
                        <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      ) : null}
                      <span className="text-[12.5px] font-medium">{item.title}</span>
                    </span>
                    {item.body ? (
                      <span className="block text-[11.5px] text-faint">{item.body}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
