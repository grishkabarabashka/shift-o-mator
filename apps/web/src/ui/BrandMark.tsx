/**
 * The product mark (ADR-0057).
 *
 * It was the letter S in a gradient square, and `theme.css` said so out loud: *"at 28px
 * there is no room for a logo, and a flat square of accent is a placeholder."* This is the
 * thing that replaces it.
 *
 * **What it draws, and why that shape.** A 24-hour ring in three arcs with gaps between
 * them: three planning units carrying one continuous day between them, and the gaps are the
 * handovers — the moments this product exists to get right. The arcs are unequal, because
 * the units are: AMER, EMEA and APAC do not each own a tidy third of the clock.
 *
 * The three arcs run at three weights of the same ink rather than three different colours.
 * Colour in this product means coverage state (`--ok`, `--warn`, `--bad`) and nothing else,
 * and a logo painting a unit red would be reading as a gap in AMER on every screen.
 *
 * Static on purpose. An earlier design had this ring live — arcs computed from the shift
 * catalogue, a hand at the current hour — and it was the wrong instrument: a logo is an
 * identity, and an identity that changes through the day is not one. The live version of
 * this idea is the clock strip, where it belongs.
 */

export function BrandMark({ size = 30 }: { readonly size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className="brand__mark"
    >
      <defs>
        {/* Lit from the top left, like every other raised surface in the app. */}
        <linearGradient id="brand-tile" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--brand-tile-from)" />
          <stop offset="100%" stopColor="var(--brand-tile-to)" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="9" fill="url(#brand-tile)" />
      {/* The inner highlight that every raised surface here carries. */}
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        fill="none"
        stroke="rgb(255 255 255 / 0.28)"
      />

      {/*
        Three equal segments with three equal gaps, drawn as one dashed circle.

        The first version drew three separate arcs at 1.0 / 0.72 / 0.45 opacity, and it read
        as a loading spinner — because that is exactly what a ring with one visible gap and a
        fading tail is. Any monotonic fade around a circle is a spinner, whatever it was
        meant to be. Equal weight and three symmetrical gaps read instead as *division*:
        one day, handed between three, with the handovers as the gaps.

        `pathLength` normalises the circumference to 100 so the dash pattern is written in
        percentages: 26 on, 7.33 off, three times. Hand-computed arc lengths would break
        silently the moment the radius moved.
      */}
      <circle
        cx="16"
        cy="16"
        r="9.4"
        fill="none"
        stroke="var(--brand-ink)"
        strokeWidth="3.2"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="26 7.333"
        /* Half a gap back from 12 o'clock, so a gap straddles the top and the mark is
           symmetric about its vertical axis rather than starting mid-segment. */
        strokeDashoffset="-3.667"
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}
