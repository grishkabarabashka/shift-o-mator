import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, useToasts } from './toasts.ts';

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });

  it('keeps only the most recent few', () => {
    // Four stacked messages is a wall of text over the grid, and the oldest is the one
    // least likely to still matter.
    for (let i = 1; i <= 5; i += 1) toast.ok(`message ${i}`);

    const messages = useToasts.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(['message 3', 'message 4', 'message 5']);
  });

  it('dismisses itself after a while', () => {
    toast.ok('published');
    expect(useToasts.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('survives being dismissed before its timer fires', () => {
    // The timer is deliberately not cancelled on manual dismiss, so it fires against an id
    // that is already gone. That has to be a no-op rather than clearing somebody else's.
    toast.ok('first');
    const [first] = useToasts.getState().toasts;
    useToasts.getState().dismiss(first!.id);

    toast.bad('second');
    vi.advanceTimersByTime(5000);
    // The second one outlives the first one's expiring timer, then goes on its own.
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('separates tones, because they are announced differently', () => {
    toast.ok('done');
    toast.bad('failed');
    expect(useToasts.getState().toasts.map((t) => t.tone)).toEqual(['ok', 'bad']);
  });
});
