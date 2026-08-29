import { describe, expect, it } from 'vitest';
import type { Location, PresenceRecord } from '../domain/types.ts';
import { TEST_PRESENCE_TYPES } from '../domain/testkit.ts';
import { cellKey } from '../domain/lookup.ts';
import { projectPresence, type PersonPresenceBaseline } from './presence.ts';

const chicago: Location = {
  id: 'loc-chicago',
  name: 'Chicago',
  timeZone: 'America/Chicago',
  country: 'US',
  holidayCalendarKey: 'us',
  weekendDays: [6, 7],
};

const newYork: Location = {
  id: 'loc-ny',
  name: 'New York',
  timeZone: 'America/New_York',
  country: 'US',
  holidayCalendarKey: 'us',
  weekendDays: [6, 7],
};

const locations = [chicago, newYork];

const dates = ['2026-09-07', '2026-09-08', '2026-09-09'];

function baseline(overrides: Partial<PersonPresenceBaseline> = {}): PersonPresenceBaseline {
  return {
    personId: 'p-1',
    defaultPresenceTypeId: 'pt-office',
    defaultSiteLocationId: chicago.id,
    ...overrides,
  };
}

function record(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    portion: 'FULL',
    id: 'pr-1',
    personId: 'p-1',
    typeId: 'pt-remote',
    from: '2026-09-07',
    to: '2026-09-08',
    source: 'MANUAL',
    version: 1,
    ...overrides,
  };
}

describe('presence marks', () => {
  it('marks the days a range covers and leaves the rest alone', () => {
    const { byCell } = projectPresence({
      records: [record()],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    expect(byCell.get(cellKey('p-1', '2026-09-07'))?.glyph).toBe('R');
    expect(byCell.get(cellKey('p-1', '2026-09-08'))?.glyph).toBe('R');
    // The range ends on the 8th; the 9th is outside it.
    expect(byCell.get(cellKey('p-1', '2026-09-09'))).toBeUndefined();
  });

  it('marks a day that matches the baseline, quietly', () => {
    // This used to produce no mark at all, on the theory that rendering the baseline
    // would fill 2500 cells. Presence records are sparse — one exists only where somebody
    // said so — so the rule suppressed the only records there were, and marking "in the
    // office" appeared to do nothing.
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-office', siteLocationId: chicago.id })],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    const mark = byCell.get(cellKey('p-1', '2026-09-07'));
    expect(mark?.glyph).toBe('O');
    expect(mark?.atBaseline).toBe(true);
  });

  it('marks an away day as not-baseline, so it can be drawn louder', () => {
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-remote' })],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    expect(byCell.get(cellKey('p-1', '2026-09-07'))?.atBaseline).toBe(false);
  });

  it('draws each way of working in its own configured colour', () => {
    // "Where is everyone" is answered by scanning, not reading: four kinds in the same
    // grey looked like one fact. The colours are the type rows' own now, so this also
    // pins that the projection reads them rather than a table of its own.
    const colours = TEST_PRESENCE_TYPES.map(
      (type) =>
        projectPresence({
          records: [record({ typeId: type.id })],
          dates,
          baselines: [baseline()],
          locations,
          presenceTypes: TEST_PRESENCE_TYPES,
        }).byCell.get(cellKey('p-1', '2026-09-07'))?.color,
    );

    expect(new Set(colours).size).toBe(TEST_PRESENCE_TYPES.length);
  });

  it('draws a record whose type it does not have, rather than nothing', () => {
    // A blank glyph reads as "nothing recorded", which is the one thing it is not — and
    // now that an administrator can delete a type, this is reachable.
    const mark = projectPresence({
      records: [record({ typeId: 'pt-deleted' })],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,
    }).byCell.get(cellKey('p-1', '2026-09-07'));

    expect(mark?.glyph).toBe('?');
  });

  it('marks a different office than the baseline, and names it', () => {
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-office', siteLocationId: newYork.id })],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    const mark = byCell.get(cellKey('p-1', '2026-09-07'));
    expect(mark?.glyph).toBe('O·N');
    expect(mark?.label).toContain('New York');
  });

  it('marks office presence for someone whose baseline is remote', () => {
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-office', siteLocationId: chicago.id })],
      dates,
      baselines: [baseline({ defaultPresenceTypeId: 'pt-remote', defaultSiteLocationId: undefined })],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    expect(byCell.get(cellKey('p-1', '2026-09-07'))?.label).toContain('Chicago');
  });

  it('carries the free-text site for travel and customer visits', () => {
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-customer-site', siteLabel: 'Acme HQ' })],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    const mark = byCell.get(cellKey('p-1', '2026-09-07'));
    expect(mark?.glyph).toBe('C');
    expect(mark?.label).toContain('Acme HQ');
  });

  it('marks everything when the person has no baseline at all', () => {
    const { byCell } = projectPresence({
      records: [record({ typeId: 'pt-office', siteLocationId: chicago.id })],
      dates,
      baselines: [],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    expect(byCell.get(cellKey('p-1', '2026-09-07'))).toBeDefined();
  });
});

describe('per-day counts', () => {
  it('counts everyone, including people matching their baseline', () => {
    // The rendering is a delta; the counts are not. "How many are in the office on
    // Monday" is a question about everyone, not about exceptions.
    const { countsByDate } = projectPresence({
      records: [
        record({ id: 'pr-1', personId: 'p-1', typeId: 'pt-office', siteLocationId: chicago.id }),
        record({ id: 'pr-2', personId: 'p-2', typeId: 'pt-remote' }),
        record({ id: 'pr-3', personId: 'p-3', typeId: 'pt-travel', siteLabel: 'Frankfurt' }),
      ],
      dates,
      baselines: [baseline(), baseline({ personId: 'p-2' }), baseline({ personId: 'p-3' })],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    const monday = countsByDate.get('2026-09-07');
    expect(monday).toEqual({ onSite: 1, remote: 1, away: 1 });
  });

  it('reports zeros for days no record covers', () => {
    const { countsByDate } = projectPresence({
      records: [record()],
      dates,
      baselines: [baseline()],
      locations,
      presenceTypes: TEST_PRESENCE_TYPES,

    });

    expect(countsByDate.get('2026-09-09')).toEqual({ onSite: 0, remote: 0, away: 0 });
  });
});
