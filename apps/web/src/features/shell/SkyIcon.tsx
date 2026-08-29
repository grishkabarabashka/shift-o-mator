/**
 * The sky over one place, as a 14px glyph (ADR-0057).
 *
 * WHY it exists: the gradient behind a clock says "night" only to somebody who already
 * knows the code. A crescent says it to everybody, in one look, and keeps saying it to a
 * person who cannot separate a deep blue from a warm orange — the phase must not rest on
 * hue alone.
 *
 * Four glyphs, one per phase, all on the same 16-unit grid so the four clocks in a row
 * have their icons at identical optical size and weight. Drawn with `currentColor`, so
 * each one inherits the ink its own sky was given and needs no palette of its own.
 */

import type { SkyPhase } from '../../engine/timeline.ts';

export function SkyIcon({ phase }: { readonly phase: SkyPhase }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      {phase === 'night' ? <Moon /> : null}
      {phase === 'day' ? <Sun /> : null}
      {phase === 'dawn' || phase === 'dusk' ? <Horizon rising={phase === 'dawn'} /> : null}
    </svg>
  );
}

/** A crescent cut from a disc, rather than a stroked arc: at 14px a stroke of any weight
 *  that reads as a moon is thick enough to close the crescent's own gap. */
function Moon() {
  return (
    <path
      d="M13 9.6A5.4 5.4 0 0 1 6.4 3 5.5 5.5 0 1 0 13 9.6Z"
      fill="currentColor"
    />
  );
}

function Sun() {
  return (
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3.1" fill="currentColor" stroke="none" />
      {/* Eight rays, written out rather than generated: a loop here would cost a key prop
          and a map for a shape that will never have a different number of rays. */}
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6" />
      <path d="M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </g>
  );
}

/**
 * Half a sun on a horizon. The arrow is what separates dawn from dusk — the two skies are
 * warm in the same way, and a rising and a setting sun look identical standing still.
 */
function Horizon({ rising }: { readonly rising: boolean }) {
  return (
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.6 10.5a3.4 3.4 0 0 1 6.8 0" fill="currentColor" stroke="none" />
      <path d="M1.8 10.5h12.4" />
      {rising ? <path d="M8 5.6V2.2M6.6 3.6 8 2.2l1.4 1.4" /> : <path d="M8 2.2v3.4M6.6 4.2 8 5.6l1.4-1.4" />}
    </g>
  );
}
