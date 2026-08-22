/**
 * NOTE: current moment, refreshed once a minute.
 *
 * The "now" marker on the timeline must move: frozen at page-load time, it
 * lies more convincingly the longer the tab stays open — and it's exactly
 * what the on-duty person reads to answer "who's on shift."
 *
 * Once a minute, not more often: the axis step is an hour, and a faster tick
 * would just redraw the lanes without a single visible pixel of difference.
 */

import { useEffect, useState } from 'react';
import type { IsoInstant } from '../domain/types.ts';

const MINUTE = 60_000;

export function useNow(intervalMs: number = MINUTE): IsoInstant {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
