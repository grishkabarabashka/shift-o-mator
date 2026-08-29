/**
 * NOTE: transient confirmations and failures (ADR-0057).
 *
 * WHY this exists: failure had three surfaces in this product — the dismissible banner on
 * Schedule, the "Not saved — retrying" pill, and the `beforeunload` guard — and success had
 * none at all. Publishing, approving, withdrawing and saving a batch of settings were all
 * confirmed only by something disappearing: a row leaving the inbox, a dirty bar
 * unmounting, a button label going back to normal. "It vanished" is indistinguishable from
 * "it was never sent".
 *
 * WHY a store and not a dependency: the app already holds UI state in Zustand, and a toast
 * queue is thirty lines. It is also raised from places that are not components —
 * `useRequestMutation`'s callbacks, store actions — which a context-only API makes awkward.
 *
 * This does NOT replace the three failure surfaces above. A failed publish still shows its
 * banner, because that message needs to stay on screen next to the draft it is about; a
 * toast is for things that are finished.
 */

import { create } from 'zustand';

export type ToastTone = 'ok' | 'bad';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

/** Long enough to read a sentence, short enough not to sit over the grid. */
const DISMISS_AFTER_MS = 4500;

/** Older ones drop off the top. Four stacked toasts is already a wall of text. */
const MAX_VISIBLE = 3;

interface ToastState {
  readonly toasts: readonly Toast[];
  readonly push: (tone: ToastTone, message: string) => void;
  readonly dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push(tone, message) {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }].slice(-MAX_VISIBLE) }));

    // The timer is not cancelled on manual dismiss: `dismiss` is idempotent, and holding a
    // handle per toast to save one no-op is bookkeeping for its own sake.
    setTimeout(() => get().dismiss(id), DISMISS_AFTER_MS);
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/** Raising a toast from outside React — a store action, a mutation callback. */
export const toast = {
  ok: (message: string) => useToasts.getState().push('ok', message),
  bad: (message: string) => useToasts.getState().push('bad', message),
};
