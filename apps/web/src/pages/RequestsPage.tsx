/**
 * The approvals queue, and a record of what you have asked for (ADR-0047).
 *
 * Raising a request lives on the **grid**, not here: asking for a Tuesday off is a
 * statement about a cell, and making people leave the schedule to say it was the
 * separate-portal problem this product exists to remove. What is left here is the part a
 * list is genuinely better at — a queue, grouped by person, with the whole of somebody's
 * ask visible at once.
 *
 * The approver list comes first. Your own list is a record; the inbox is a queue, and a
 * queue nobody looks at is the failure mode self-service cannot survive.
 */

import { useState } from 'react';
import {
  useCancelRequest,
  useCreateRequest,
  useDecideRequest,
  useRequests,
  useRequestTypes,
  type RequestState,
  type RequestView,
} from '../api/requests.ts';
import type { Location } from '../domain/types.ts';
import { Select, type SelectOption } from '../ui/primitives.tsx';
import { useSchedule } from '../store/useSchedule.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import type { PlanningView } from '../features/planning/usePlanningView.ts';

/** NOTE: Plain words, not enum names — this is the only place the state is user-facing. */
const STATE_LABEL: Record<RequestState, string> = {
  DRAFT: 'Returned to you',
  SUBMITTED: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Withdrawn',
  APPLIED: 'Approved',
  APPLY_FAILED: 'Approved, not applied',
};

const STATE_TONE: Record<RequestState, 'ok' | 'warn' | 'bad' | 'muted'> = {
  DRAFT: 'warn',
  SUBMITTED: 'warn',
  APPROVED: 'ok',
  REJECTED: 'bad',
  CANCELLED: 'muted',
  APPLIED: 'ok',
  APPLY_FAILED: 'bad',
};

export function RequestsPage({ view }: { readonly view: PlanningView }) {
  const mine = useRequests('mine');
  const inbox = useRequests('inbox');

  return (
    /* Measured and centred (ADR-0057). This screen is a form of small fields and three
       short lists; run to 1920px it put a 150px date input at one end of the monitor and
       its label at the other, and every list row became a line of text with a hundred
       characters of white space after it. Settings already does this at 1200px — a form is
       narrower still. */
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[880px] flex-col gap-3 overflow-y-auto p-4">
      <PageHeader title="Requests" context="Ask for something, and decide what is waiting on you" />

      <NewRequestCard locations={view.locations} />


      <section className="card p-3">
        <h2 className="mb-2 text-[13px] font-semibold">Waiting on you</h2>
        {inbox.data && inbox.data.length > 0 ? (
          groupBySubject(inbox.data).map((group) => (
            <div key={group.personId} className="mb-2 last:mb-0">
              {/* Grouped by person: an approver decides about people, not about rows,
                  and three separate asks from the same person are one conversation. */}
              <h3 className="mb-0.5 text-[12px] font-semibold text-faint">
                {group.displayName}
                <span className="ml-1.5 font-normal">({group.items.length})</span>
              </h3>
              <ul className="rows">
                {group.items.map((item) => (
                  <RequestRow key={item.request.id} item={item} showSubject={false} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <ListFallback query={inbox} empty="Nothing needs your decision." />
        )}
      </section>

      <section className="card p-3">
        <h2 className="mb-2 text-[13px] font-semibold">Your requests</h2>
        {mine.data && mine.data.length > 0 ? (
          <ul className="rows">
            {mine.data.map((item) => (
              <RequestRow key={item.request.id} item={item} showSubject={false} />
            ))}
          </ul>
        ) : (
          <ListFallback query={mine} empty="You have not asked for anything yet." />
        )}
      </section>
    </div>
  );
}

/**
 * What a list says when it has nothing to show.
 *
 * WHY it is not just the empty sentence: both lists rendered their empty copy whenever
 * `data` was falsy, and a failed fetch makes `data` falsy. "Nothing needs your decision"
 * was therefore also what an approver saw when the API was unreachable — an error state
 * that reads as good news, which is the worst way for one to read. `retry: 1` and no global
 * error handler (`api/queryClient.ts`) meant nothing else would have said so either.
 */
function ListFallback({
  query,
  empty,
}: {
  readonly query: { readonly isError: boolean; readonly isLoading: boolean; readonly refetch: () => unknown };
  readonly empty: string;
}) {
  if (query.isLoading) return <p className="text-sm text-faint">Loading…</p>;

  if (query.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-bad">
        <span>This list could not be loaded.</span>
        <button type="button" className="btn btn--sm" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return <p className="text-sm text-faint">{empty}</p>;
}

interface SubjectGroup {
  readonly personId: string;
  readonly displayName: string;
  readonly items: readonly RequestView[];
}

function groupBySubject(items: readonly RequestView[]): SubjectGroup[] {
  const byPerson = new Map<string, RequestView[]>();
  for (const item of items) {
    const bucket = byPerson.get(item.request.subjectPersonId);
    if (bucket) bucket.push(item);
    else byPerson.set(item.request.subjectPersonId, [item]);
  }

  return [...byPerson.entries()]
    .map(([personId, group]) => ({
      personId,
      displayName: group[0]?.subjectDisplayName ?? personId,
      items: group,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function NewRequestCard({ locations }: { readonly locations: readonly Location[] }) {
  const types = useRequestTypes();
  const create = useCreateRequest();

  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [siteLocationId, setSiteLocationId] = useState('');
  const [note, setNote] = useState('');

  const presenceTypes = useSchedule((s) => s.reference?.presenceTypes) ?? [];
  const selected = types.data?.find((t) => t.id === typeId);
  // A way of working that names one of our offices needs to know which.
  const needsSite =
    selected?.presenceTypeId !== undefined &&
    (presenceTypes.find((t) => t.id === selected.presenceTypeId)?.namesALocation ?? false);
  // `to` defaults to `from`: a one-day request is the common case, and making people
  // fill the same date twice is the kind of friction that sends them back to email.
  const effectiveTo = to || from;
  const ready = typeId !== '' && from !== '' && effectiveTo >= from;

  const typeOptions: readonly SelectOption[] = [
    { value: '', label: '— choose —' },
    ...(types.data ?? []).map((t) => ({ value: t.id, label: t.label })),
  ];

  const locationOptions: readonly SelectOption[] = [
    { value: '', label: '— any office —' },
    ...locations.map((l) => ({ value: l.id, label: l.name })),
  ];

  const submit = () => {
    if (!ready) return;
    create.mutate(
      {
        typeId,
        from,
        to: effectiveTo,
        ...(note ? { note } : {}),
        ...(needsSite && siteLocationId ? { siteLocationId } : {}),
      },
      {
        onSuccess: () => {
          setTypeId('');
          setFrom('');
          setTo('');
          setSiteLocationId('');
          setNote('');
        },
      },
    );
  };

  return (
    <section className="card p-3">
      <h2 className="mb-2 text-[13px] font-semibold">Ask for something</h2>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">What</span>
          <Select value={typeId} onChange={setTypeId} options={typeOptions} ariaLabel="Request type" />
        </label>

        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">From</span>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>

        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">To</span>
          <input
            type="date"
            className="input"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            placeholder={from}
          />
        </label>

        {needsSite ? (
          <label className="text-[12.5px]">
            <span className="mb-1 block font-medium">Office</span>
            <Select
              value={siteLocationId}
              onChange={setSiteLocationId}
              options={locationOptions}
              ariaLabel="Office"
            />
          </label>
        ) : null}

        <label className="min-w-[180px] flex-1 text-[12.5px]">
          <span className="mb-1 block font-medium">Note (optional)</span>
          <input
            className="input w-full"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={!ready || create.isPending}
          onClick={submit}
        >
          {create.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {create.isError ? (
        <p role="alert" className="mt-2 text-[12.5px] text-bad">
          {create.error instanceof Error ? create.error.message : 'Could not send the request.'}
        </p>
      ) : null}
    </section>
  );
}

function RequestRow({
  item,
  showSubject,
}: {
  readonly item: RequestView;
  readonly showSubject: boolean;
}) {
  const decide = useDecideRequest();
  const cancel = useCancelRequest();
  const [comment, setComment] = useState('');

  const { request } = item;
  const pending = request.state === 'SUBMITTED';
  const live = request.state === 'APPLIED' || request.state === 'APPROVED';
  const lastComment = request.decisions.at(-1)?.comment;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2 last:border-b-0">
      {/* Two spans, not one interpolated string: "who" and "what" are different facts,
          and joining them makes the type label unaddressable to anything reading the
          DOM — assistive tech and tests alike. */}
      {showSubject ? (
        <span className="text-[12.5px] font-medium">{item.subjectDisplayName}</span>
      ) : null}
      <span className="text-[12.5px] font-medium">{item.typeLabel}</span>

      <span className="text-[12.5px] text-faint">
        {request.from === request.to ? request.from : `${request.from} → ${request.to}`}
      </span>

      <span className={`pill pill--${STATE_TONE[request.state]}`}>
        {STATE_LABEL[request.state]}
      </span>

      {request.note ? <span className="text-[12px] text-faint">“{request.note}”</span> : null}

      {/* The approver's own words survive every later state change, so show the latest
          — a bare "Declined" with no reason is what makes people re-ask by email. */}
      {lastComment ? <span className="text-[12px] text-faint">— {lastComment}</span> : null}

      {request.state === 'APPLY_FAILED' && request.failureReason ? (
        <span className="text-[12px] text-bad">{request.failureReason}</span>
      ) : null}

      <span className="ml-auto flex items-center gap-1.5">
        {pending && item.callerCanDecide ? (
          <>
            <input
              className="input w-[150px]"
              placeholder="Comment (optional)"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              aria-label={`Comment on ${item.typeLabel}`}
            />
            <button
              type="button"
              className="btn btn--sm btn--primary"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  id: request.id,
                  decision: 'APPROVE',
                  ...(comment ? { comment } : {}),
                })
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn--sm"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  id: request.id,
                  decision: 'REJECT',
                  ...(comment ? { comment } : {}),
                })
              }
            >
              Decline
            </button>
          </>
        ) : null}

        {(pending || live) && !showSubject ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ id: request.id })}
            title={
              live
                ? 'Withdraw this — the leave or presence it created is removed too'
                : 'Withdraw this request'
            }
          >
            Withdraw
          </button>
        ) : null}
      </span>
    </li>
  );
}
