import { describe, expect, it } from 'vitest';
import {
  dateAtFraction,
  fractionOf,
  overviewRange,
  rangeFor,
  rangeLength,
  scrubberTrack,
  jumpAnchorMonths,
  stepAnchor,
  zoomSpec,
  stepOverviewAnchor,
} from './period.ts';

describe('range zoom (Schedule — minimum a month, ADR-0036)', () => {
  it('month/quarter/half-year align to the 1st', () => {
    // 2026-09-09 is a Wednesday.
    // The window runs forward *from the selected day*, with two days of context behind
    // it — not snapped to a calendar month. Picking the 27th used to show the 1st–31st
    // with the interesting part at the far right.
    // Nine columns: a week from the anchor, plus the two days of lead-in every zoom keeps.
    expect(rangeFor('week', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-09-15' });
    expect(rangeFor('month', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-10-06' });
    expect(rangeFor('two-months', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-11-06' });
    expect(rangeFor('quarter', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-12-06' });
    expect(rangeFor('half-year', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2027-03-06' });
  });

  it('the step equals the length of the current zoom', () => {
    // One day, whatever the zoom: a planner follows the rota along it.
    expect(stepAnchor('2026-09-09', 1)).toBe('2026-09-10');
    expect(stepAnchor('2026-09-09', -1)).toBe('2026-09-08');
    // A month is still one click, on its own control.
    expect(jumpAnchorMonths('2026-09-09', 1)).toBe('2026-10-09');
    expect(jumpAnchorMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('the selected day sits near the left edge, not buried in the middle', () => {
    // The complaint this fixes: picking the 27th showed the 1st to the 31st, with the
    // part being planned pushed to the far right of the grid.
    const range = rangeFor('month', '2026-08-27');
    expect(range.from).toBe('2026-08-25');
    expect(range.to).toBe('2026-09-24');
  });

  it('two months is editable; three and six are not', () => {
    expect(zoomSpec('month').detail).toBe(true);
    expect(zoomSpec('two-months').detail).toBe(true);
    expect(zoomSpec('quarter').detail).toBe(false);
    expect(zoomSpec('half-year').detail).toBe(false);
  });
});

describe('Overview window (1/3/7 days, ADR-0036)', () => {
  it('the window is span days from the anchor plus that much context on each side', () => {
    expect(overviewRange('2026-09-09', 1)).toEqual({ from: '2026-09-08', to: '2026-09-10' });
    expect(overviewRange('2026-09-09', 3)).toEqual({ from: '2026-09-06', to: '2026-09-14' });
    expect(overviewRange('2026-09-09', 7)).toEqual({ from: '2026-09-02', to: '2026-09-22' });
  });

  it('the step equals the width of the visible window, not the window with context', () => {
    expect(stepOverviewAnchor('2026-09-09', 1, 1)).toBe('2026-09-10');
    expect(stepOverviewAnchor('2026-09-09', 7, 1)).toBe('2026-09-16');
    expect(stepOverviewAnchor('2026-09-09', 3, -1)).toBe('2026-09-06');
  });
});

describe('scrubber track: fractionOf and dateAtFraction are mutual inverses', () => {
  it('edge to edge with no off-by-one day', () => {
    const track = scrubberTrack('2026-09-09');

    // The left edge is 0, and the inverse gives exactly the track's first day.
    expect(fractionOf(track, track.from)).toBe(0);
    expect(dateAtFraction(track, 0)).toBe(track.from);

    // Right edge: `dateAtFraction` used to use a `total - 1` denominator
    // against `fractionOf`'s `total`, and dragging all the way to the edge
    // missed by a day. A fraction of 1.0 must land on the track's last day.
    expect(dateAtFraction(track, 1)).toBe(track.to);
  });

  it('an arbitrary date within the track round-trips through its own fraction', () => {
    const track = scrubberTrack('2026-09-09');
    const total = rangeLength(track);
    for (let offset = 0; offset < total; offset += 7) {
      const date = dateAtFraction(track, offset / total);
      expect(fractionOf(track, date)).toBeCloseTo(offset / total, 5);
    }
  });

  it('a fraction outside [0,1] clamps to the track edge', () => {
    const track = scrubberTrack('2026-09-09');
    expect(dateAtFraction(track, -0.5)).toBe(track.from);
    expect(dateAtFraction(track, 1.5)).toBe(track.to);
  });
});
