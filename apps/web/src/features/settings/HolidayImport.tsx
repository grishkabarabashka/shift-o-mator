/**
 * Holidays from a published calendar feed, instead of typing a year of them.
 *
 * WHY it is a preview and then an import, rather than one button: a year of holidays is
 * twenty rows written into a table other people are planning against, and the only honest
 * moment to notice a wrong calendar is before it lands. The preview marks the days that
 * are already there, so the second run of the same feed visibly does nothing rather than
 * appearing to have failed.
 *
 * WHY the file is read here and the URL is fetched by the server: a browser cannot fetch
 * a calendar host it has no CORS grant from, which is all of them. The server can, and is
 * held to an allowlist for exactly that reason.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../api/client.ts';
import { referenceQueryKey } from '../../api/queries.ts';
import type { Location } from '../../domain/types.ts';

interface ImportRow {
  readonly date: string;
  readonly name: string;
  /** The feed's own classification: "Public holiday", "Observance", or nothing. */
  readonly category: string;
  readonly alreadyPresent: boolean;
  /** An observance the filter dropped. Listed, never written. */
  readonly skipped: boolean;
}

interface Calendar {
  readonly id: string;
  readonly country: string;
  readonly name: string;
  readonly url: string;
}

interface ImportResponse {
  readonly days: readonly ImportRow[];
  readonly added: number;
}

export function HolidayImport({ locations }: { readonly locations: readonly Location[] }) {
  const queryClient = useQueryClient();
  // Only calendars the server is allowed to fetch come back, so the picker cannot offer
  // one that would then be refused.
  const calendars = useQuery({
    queryKey: ['admin', 'holiday-calendars'],
    queryFn: () => apiGet<readonly Calendar[]>('/api/admin/holidays/calendars'),
    staleTime: Infinity,
  });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [url, setUrl] = useState('');
  const [holidaysOnly, setHolidaysOnly] = useState(true);
  const [ics, setIcs] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<readonly ImportRow[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const chosen = calendars.data?.find((c) => c.id === calendarId);
      const result = await apiPost<ImportResponse>('/api/admin/holidays/import', {
        locationIds: selected,
        url: chosen?.url ?? (url.trim() || null),
        holidaysOnly,
        ics: ics.trim() || null,
        from: from || null,
        to: to || null,
        apply,
      });
      setRows(result.days);
      if (apply) {
        setMessage(
          result.added === 0
            ? 'Nothing to add — every one of those days was already a holiday here.'
            : `Added ${result.added} ${result.added === 1 ? 'holiday' : 'holidays'}.`,
        );
        await queryClient.invalidateQueries({ queryKey: referenceQueryKey });
        await queryClient.invalidateQueries({ queryKey: ['admin', 'holidays'] });
      }
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setIcs(String(reader.result ?? ''));
      setUrl('');
    };
    reader.readAsText(file);
  };

  const newDays = rows.filter((row) => !row.alreadyPresent && !row.skipped).length;
  const ready = calendarId !== '' || url.trim() !== '' || ics.trim() !== '';

  if (!open) {
    return (
      <div>
        <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
          Import from a calendar…
        </button>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Import holidays from a calendar</h2>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <p className="text-[11.5px] text-muted">
        A country&rsquo;s published public holidays, or any other iCalendar feed. Days that
        are already holidays for the locations you pick are left alone, so running this
        again next year is safe.
      </p>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted">Applies to</div>
        <div className="flex flex-wrap gap-2">
          {locations.map((location) => (
            <label key={location.id} className="flex items-center gap-1 text-[11.5px]">
              <input
                type="checkbox"
                checked={selected.includes(location.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, location.id]
                      : selected.filter((id) => id !== location.id),
                  )
                }
              />
              {location.name}
            </label>
          ))}
        </div>
      </div>

      {/* The country comes first because it is what an administrator has in mind. The URL
          and the file are the fallback for a feed nobody has listed, not the main road —
          which is what they were, and it meant knowing where a public holiday calendar
          lives before you could use one. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
          Country
          <select
            className="field w-[260px] text-[12px]"
            value={calendarId}
            onChange={(e) => {
              setCalendarId(e.target.value);
              if (e.target.value) {
                setUrl('');
                setIcs('');
              }
            }}
          >
            <option value="">— choose a published calendar —</option>
            {(calendars.data ?? []).map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.country}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
          From
          <input
            type="date"
            className="field text-[12px]"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
          To
          <input
            type="date"
            className="field text-[12px]"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-[11.5px]">
          <input
            type="checkbox"
            checked={holidaysOnly}
            onChange={(e) => setHolidaysOnly(e.target.checked)}
          />
          <span title="A national calendar carries observances too — two entries in three. Valentine's Day is not a day off.">
            Public holidays only
          </span>
        </label>
      </div>

      <details className="text-[11.5px]">
        <summary className="cursor-pointer text-muted">Another calendar</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
            Calendar URL
            <input
              type="url"
              className="field w-[380px] text-[12px]"
              placeholder="https://…/basic.ics"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (e.target.value) {
                  setIcs('');
                  setCalendarId('');
                }
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted">
            &hellip;or a file
            <input
              type="file"
              accept=".ics,text/calendar"
              className="text-[11.5px]"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          A URL is fetched by the server, and only from a host an administrator has
          allowed. A file never leaves the browser until you press Import.
        </p>
      </details>

      {ics ? (
        <p className="text-[11px] text-faint">
          Calendar loaded from a file ({ics.length.toLocaleString()} characters). Clear it
          by typing a URL above.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy || selected.length === 0 || !ready}
          onClick={() => void run(false)}
        >
          Preview
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy || rows.length === 0 || newDays === 0}
          onClick={() => void run(true)}
          title={
            rows.length === 0
              ? 'Preview it first'
              : `Adds ${newDays} ${newDays === 1 ? 'day' : 'days'}`
          }
        >
          Import {newDays > 0 ? newDays : ''}
        </button>
        {message ? <span className="text-[11.5px] text-muted">{message}</span> : null}
      </div>

      {rows.length > 0 ? (
        <div className="max-h-[280px] overflow-y-auto">
          <table className="rows">
            <thead>
              <tr>
                <th className="w-[110px]">Date</th>
                <th>Name</th>
                <th className="w-[130px]">In the calendar</th>
                <th className="w-[130px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.date}-${row.name}`}
                  className={row.alreadyPresent || row.skipped ? 'opacity-45' : undefined}
                >
                  <td className="font-mono text-[12px]">{row.date}</td>
                  <td>{row.name}</td>
                  <td className="text-[11.5px] text-faint">{row.category || '—'}</td>
                  <td className="text-[11.5px] text-faint">
                    {row.skipped
                      ? 'Not a holiday'
                      : row.alreadyPresent
                        ? 'Already a holiday'
                        : 'New'}
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
