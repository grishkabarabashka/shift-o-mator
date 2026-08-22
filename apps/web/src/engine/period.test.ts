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

describe('масштаб периода (Schedule — минимум месяц, ADR-0036)', () => {
  it('month/quarter/half-year выравниваются на 1-е число', () => {
    // 2026-09-09 — среда.
    expect(rangeFor('month', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeFor('quarter', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(rangeFor('half-year', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2027-02-28' });
  });

  it('шаг равен длине текущего масштаба', () => {
    expect(stepAnchor('month', '2026-09-09', 1)).toBe('2026-10-01');
    expect(stepAnchor('quarter', '2026-09-09', 1)).toBe('2026-12-01');
  });
});

describe('окно Overview (1/3/7 суток, ADR-0036)', () => {
  it('окно — span суток от якоря плюс столько же контекста с каждой стороны', () => {
    expect(overviewRange('2026-09-09', 1)).toEqual({ from: '2026-09-08', to: '2026-09-10' });
    expect(overviewRange('2026-09-09', 3)).toEqual({ from: '2026-09-06', to: '2026-09-14' });
    expect(overviewRange('2026-09-09', 7)).toEqual({ from: '2026-09-02', to: '2026-09-22' });
  });

  it('шаг равен ширине видимого окна, а не окну с контекстом', () => {
    expect(stepOverviewAnchor('2026-09-09', 1, 1)).toBe('2026-09-10');
    expect(stepOverviewAnchor('2026-09-09', 7, 1)).toBe('2026-09-16');
    expect(stepOverviewAnchor('2026-09-09', 3, -1)).toBe('2026-09-06');
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
