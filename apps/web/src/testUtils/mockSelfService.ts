/**
 * Mock handlers for presence, requests, approvals and the inbox (ADR-0043, ADR-0047).
 *
 * Split out of `mockApi.ts` because it is a second, self-contained surface: the plan
 * handlers model a schedule, these model a workflow, and the only thing they share is
 * the dataset an approval writes into. Keeping them together made the one file the
 * place every new endpoint went, regardless of what it was about.
 *
 * The approval path deliberately materializes, exactly as the server does — a test that
 * approves a remote-work request and then asserts the presence record exists is testing
 * the thing that actually matters.
 */

import { HttpResponse, http } from 'msw';
import type { PresenceRecord } from '../domain/types.ts';
import { mockBackend } from './mockApi.ts';

/** NOTE: Mirrors the seeded types on the server (`FixtureSeeder.SeedSelfServiceAsync`). */
export const MOCK_REQUEST_TYPES = [
  {
    id: 'rt-remote',
    code: 'REMOTE',
    label: 'Work remotely',
    category: 'presence',
    presenceTypeId: 'pt-remote',
  },
  {
    id: 'rt-office',
    code: 'OFFICE',
    label: 'Work from an office',
    category: 'presence',
    presenceTypeId: 'pt-office',
  },
  { id: 'rt-vacation', code: 'VACATION', label: 'Annual leave', category: 'leave' },
  // Sickness is requested like any other leave (ADR-0052); without a type for it the
  // menu offered sick leave and had nowhere to send it.
  { id: 'rt-sick', code: 'SICK', label: 'Sick leave', category: 'leave' },
  { id: 'rt-comp-day', code: 'COMP_DAY', label: 'Comp day', category: 'compDay' },
] as const;

export interface MockRequest {
  id: string;
  typeId: string;
  subjectPersonId: string;
  unitId: string;
  from: string;
  to: string;
  note: string | null;
  state: string;
  createdAt: string;
  decisions: {
    id: string;
    step: number;
    decision: string;
    byPersonId: string;
    comment: string | null;
    at: string;
  }[];
}

export interface MockNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  subjectType: string;
  subjectId: string;
  createdAt: string;
  readAt: string | null;
}

function camelOf(value: string): string {
  const [first = '', ...rest] = value.toLowerCase().split('_');
  return first + rest.map((part) => part[0]?.toUpperCase() + part.slice(1)).join('');
}


function buildPresence(body: Record<string, unknown>, id: string): PresenceRecord {
  return {
    id,
    personId: body.personId as string,
    typeId: body.typeId as string,
    ...(body.siteLocationId ? { siteLocationId: body.siteLocationId as string } : {}),
    ...(body.siteLabel ? { siteLabel: body.siteLabel as string } : {}),
    ...(body.requestId ? { requestId: body.requestId as string } : {}),
    from: body.from as string,
    to: body.to as string,
    source: (body.source as PresenceRecord['source']) ?? 'MANUAL',
    portion: 'FULL',
    version: 1,
  };
}

export function presenceToWire(p: PresenceRecord) {
  return {
    ...p,
    source: camelOf(p.source),
    siteLocationId: p.siteLocationId ?? null,
    siteLabel: p.siteLabel ?? null,
    requestId: p.requestId ?? null,
    note: p.note ?? null,
  };
}

export function selfServiceHandlers(base: string) {
  return [
    // -- Presence ------------------------------------------------------------

    http.get(`${base}/api/presence`, ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      // Overlap, not containment — same predicate the server uses.
      const records = mockBackend.data.presence.filter((p) => p.from <= to && p.to >= from);
      return HttpResponse.json({ presence: records.map(presenceToWire) });
    }),

    http.post(`${base}/api/presence`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const created = buildPresence(body, mockBackend.nextId('presence'));
      mockBackend.data = {
        ...mockBackend.data,
        presence: [...mockBackend.data.presence, created],
      };
      return HttpResponse.json(presenceToWire(created), { status: 201 });
    }),

    http.put(`${base}/api/presence/:id`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const id = params.id as string;
      const existing = mockBackend.data.presence.find((p) => p.id === id);
      if (!existing) return HttpResponse.json({ code: 'PRESENCE_NOT_FOUND' }, { status: 404 });
      const updated = { ...buildPresence(body, id), version: existing.version + 1 };
      mockBackend.data = {
        ...mockBackend.data,
        presence: mockBackend.data.presence.map((p) => (p.id === id ? updated : p)),
      };
      return HttpResponse.json(presenceToWire(updated));
    }),

    http.delete(`${base}/api/presence/:id`, ({ params }) => {
      mockBackend.data = {
        ...mockBackend.data,
        presence: mockBackend.data.presence.filter((p) => p.id !== params.id),
      };
      return new HttpResponse(null, { status: 204 });
    }),

    // -- Requests and approvals ----------------------------------------------

    http.get(`${base}/api/request-types`, () => HttpResponse.json(MOCK_REQUEST_TYPES)),

    http.get(`${base}/api/requests`, ({ request }) => {
      const scope = new URL(request.url).searchParams.get('scope');
      const me = mockBackend.currentPersonId;
      const views = mockBackend.requests
        .filter((r) =>
          scope === 'mine'
            ? r.subjectPersonId === me
            : scope === 'inbox'
              ? r.state === 'submitted'
              : true,
        )
        .map((r) => ({
          request: r,
          typeCode: MOCK_REQUEST_TYPES.find((t) => t.id === r.typeId)?.code ?? 'UNKNOWN',
          typeLabel: MOCK_REQUEST_TYPES.find((t) => t.id === r.typeId)?.label ?? 'Unknown',
          subjectDisplayName:
            mockBackend.data.people.find((p) => p.id === r.subjectPersonId)?.displayName ??
            r.subjectPersonId,
          pendingApproverIds: [me],
          // The stub caller is a unit manager, which is what the seeded planner route
          // resolves to — so they are both requester and approver here, same as on a
          // real single-manager unit.
          callerCanDecide: r.state === 'submitted',
        }));
      return HttpResponse.json({ requests: views });
    }),

    http.post(`${base}/api/requests`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const me = mockBackend.currentPersonId;
      // Absent means "about me", exactly as the server defaults it. Ignoring the field
      // entirely is what let a live bug through: the menu stopped sending a subject and
      // every request a planner raised on somebody else landed on the planner.
      const subject = (body.subjectPersonId as string | null | undefined) ?? me;
      const now = new Date().toISOString();
      const created: MockRequest = {
        id: mockBackend.nextId('req'),
        typeId: body.typeId as string,
        subjectPersonId: subject,
        unitId: mockBackend.data.people.find((p) => p.id === subject)?.unitId ?? 'unit-amer',
        from: body.from as string,
        to: body.to as string,
        note: (body.note as string | null) ?? null,
        state: 'submitted',
        createdAt: now,
        decisions: [],
      };
      mockBackend.requests.push(created);
      mockBackend.notifications.push({
        id: mockBackend.nextId('note'),
        kind: 'requestSubmitted',
        title: 'A request needs your decision',
        body: `${created.from} – ${created.to}`,
        subjectType: 'request',
        subjectId: created.id,
        createdAt: now,
        readAt: null,
      });
      return HttpResponse.json(created, { status: 201 });
    }),

    http.post(`${base}/api/requests/:id/decide`, async ({ params, request }) => {
      const body = (await request.json()) as { decision: string; comment?: string | null };
      const found = mockBackend.requests.find((r) => r.id === params.id);
      if (!found) return HttpResponse.json({ code: 'REQUEST_NOT_FOUND' }, { status: 404 });
      if (found.state !== 'submitted') {
        return HttpResponse.json({ code: 'REQUEST_NOT_PENDING' }, { status: 400 });
      }

      const now = new Date().toISOString();
      found.decisions.push({
        id: mockBackend.nextId('dec'),
        step: 0,
        decision: body.decision,
        byPersonId: mockBackend.currentPersonId,
        comment: body.comment ?? null,
        at: now,
      });

      if (body.decision !== 'approve') {
        found.state = 'rejected';
        return HttpResponse.json(found);
      }

      // Approved *and* applied are separate states on the server; the write is what
      // distinguishes them, so the mock does the write.
      const type = MOCK_REQUEST_TYPES.find((t) => t.id === found.typeId);
      if (type && 'presenceTypeId' in type) {
        const created = buildPresence(
          {
            personId: found.subjectPersonId,
            typeId: type.presenceTypeId,
            from: found.from,
            to: found.to,
            requestId: found.id,
            source: 'REQUEST',
          },
          mockBackend.nextId('presence'),
        );
        mockBackend.data = {
          ...mockBackend.data,
          presence: [...mockBackend.data.presence, created],
        };
      }
      found.state = 'applied';
      return HttpResponse.json(found);
    }),

    http.post(`${base}/api/requests/:id/cancel`, ({ params }) => {
      const found = mockBackend.requests.find((r) => r.id === params.id);
      if (!found) return HttpResponse.json({ code: 'REQUEST_NOT_FOUND' }, { status: 404 });
      found.state = 'cancelled';
      mockBackend.data = {
        ...mockBackend.data,
        presence: mockBackend.data.presence.filter((p) => p.requestId !== found.id),
      };
      return HttpResponse.json(found);
    }),

    // -- Cell audit ------------------------------------------------------------

    http.get(`${base}/api/history/cell`, ({ request }) => {
      const url = new URL(request.url);
      const personId = url.searchParams.get('personId') ?? '';
      const date = url.searchParams.get('date') ?? '';
      // The merged stream the server builds: requests covering the date, plus their
      // decisions, on one time axis (ADR-0050).
      const events = mockBackend.requests
        .filter((r) => r.subjectPersonId === personId && r.from <= date && r.to >= date)
        .flatMap((r) => [
          {
            at: r.createdAt,
            kind: 'requestSubmitted',
            actorId: r.subjectPersonId,
            actorName: null,
            summary: `Requested: ${r.typeId} (${r.from}..${r.to})`,
            comment: r.note,
          },
          ...r.decisions.map((d) => ({
            at: d.at,
            kind: 'requestDecided',
            actorId: d.byPersonId,
            actorName: null,
            summary: `${d.decision}: ${r.typeId}`,
            comment: d.comment,
          })),
        ])
        .sort((a, b) => a.at.localeCompare(b.at));
      return HttpResponse.json({ personId, date, events });
    }),

    // -- Inbox ----------------------------------------------------------------

    http.get(`${base}/api/notifications`, () =>
      HttpResponse.json({
        notifications: mockBackend.notifications,
        unreadCount: mockBackend.notifications.filter((n) => n.readAt === null).length,
      }),
    ),

    http.post(`${base}/api/notifications/read`, () => {
      const now = new Date().toISOString();
      for (const item of mockBackend.notifications) item.readAt ??= now;
      return HttpResponse.json({ markedRead: mockBackend.notifications.length });
    }),
  ];
}
