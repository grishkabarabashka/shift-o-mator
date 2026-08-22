import { describe, expect, it } from 'vitest';
import {
  dateAtFraction,
  fractionOf,
  rangeFor,
  rangeLength,
  scrubberTrack,
  stepAnchor,
} from './period.ts';

describe('масштаб периода', () => {
  it('day/two-day не выравниваются, week/two-week — по понедельнику', () => {
    // 2026-09-09 — среда.
    expect(rangeFor('day', '2026-09-09')).toEqual({ from: '2026-09-09', to: '2026-09-09' });
    expect(rangeFor('two-day', '2026-09-09')).toEqual({ from: '2026-09-09', to: '2026-09-10' });
    expect(rangeFor('week', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(rangeFor('two-week', '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-09-20' });
  });

  it('шаг равен длине текущего масштаба', () => {
    expect(stepAnchor('week', '2026-09-09', 1)).toBe('2026-09-16');
    expect(stepAnchor('month', '2026-09-09', 1)).toBe('2026-10-01');
  });
});

describe('дорожка шкалы: fractionOf и dateAtFraction — взаимно обратные', () => {
  it('край в край без промаха на день', () => {
    const track = scrubberTrack('2026-09-09');

    // Левый край — 0, обратно получаем ровно первый день дорожки.
    expect(fractionOf(track, track.from)).toBe(0);
    expect(dateAtFraction(track, 0)).toBe(track.from);

    // Правый край: раньше `dateAtFraction` использовал знаменатель `total - 1`
    // против `total` у `fractionOf`, и перетаскивание до упора промахивалось
    // на сутки. Доля 1.0 обязана остаться на последнем дне дорожки.
    expect(dateAtFraction(track, 1)).toBe(track.to);
  });

  it('произвольная дата внутри дорожки восстанавливается через свою долю', () => {
    const track = scrubberTrack('2026-09-09');
    const total = rangeLength(track);
    for (let offset = 0; offset < total; offset += 7) {
      const date = dateAtFraction(track, offset / total);
      expect(fractionOf(track, date)).toBeCloseTo(offset / total, 5);
    }
  });

  it('доля за пределами [0,1] прижимается к краю дорожки', () => {
    const track = scrubberTrack('2026-09-09');
    expect(dateAtFraction(track, -0.5)).toBe(track.from);
    expect(dateAtFraction(track, 1.5)).toBe(track.to);
  });
});
