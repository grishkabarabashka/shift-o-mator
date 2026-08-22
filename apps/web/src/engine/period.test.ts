import { describe, expect, it } from 'vitest';
import {
  dateAtFraction,
  fractionOf,
  overviewRange,
  rangeFor,
  rangeLength,
  scrubberTrack,
  stepAnchor,
  stepOverviewAnchor,
} from './period.ts';

describe('range zoom (Schedule — minimum a month, ADR-0036)', () => {
  it('month/quarter/half-year align to the 1st', () => {
    // 2026-09-09 is a Wednesday.
    expect(rangeFor('month', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeFor('quarter', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(rangeFor('half-year', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2027-02-28' });
  });

  it('the step equals the length of the current zoom', () => {
    expect(stepAnchor('month', '2026-09-09', 1)).toBe('2026-10-01');
    expect(stepAnchor('quarter', '2026-09-09', 1)).toBe('2026-12-01');
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
