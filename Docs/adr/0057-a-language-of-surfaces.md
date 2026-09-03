# ADR-0057. A language of surfaces: light, measure, elevation

**Status:** accepted. Extends [ADR-0022](0022-tailwind-for-tokens-and-layout.md) (Tailwind
for tokens and layout) and [ADR-0013](0013-headless-ui-layer.md) (headless UI); does not narrow
either.

## Context

The product was functionally complete and looked exactly like what it is — an internal
tool. The cause was not a shortage of decoration. It was a shortage of **hierarchy**:
everything on a screen carried the same weight, so the eye had nothing to land on.

Four specifics, all visible in the code before this change:

- **One rung of elevation for everything.** `.card` carried a single shadow,
  `0 1px 2px rgb(16 24 40 / 0.04)`, and so did the period control, the stat row and the
  planning grid. Three other shadows existed (popover, dialog, masthead) but were set per
  component and formed no ladder, so there was no way to say "this one matters".
- **Nothing had a measure.** `.calendar__grid` is `repeat(7, minmax(0, 1fr))` inside a
  `flex-1` card: on a wide monitor a day box became ~230px wide and 76px tall, a shape no
  calendar has ever had. Requests ran a form of 150px fields across the full width.
  Settings already capped itself at 1200px, so the pattern existed and was unused.
- **No scale.** Text sizes were a dozen literals (10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5,
  14.5, 15, 16, 18, 22px); radii were ten values set per component. Overview, Schedule and
  Requests had no `h1` at all.
- **Responsive existed as four `hidden … lg:` classes.** The whole of the small-screen
  behaviour was removing controls — among them the display-timezone picker, which
  `AppShell` itself documents as governing how time reads on every screen.

## Decision

**Light is information, and measure is focus.**

### 1. Elevation is a ladder of five, with one rule

`--elev-0` … `--elev-4`. The rule that makes them mean anything: **exactly one surface per
screen sits on `--elev-2`** — the one the screen exists for (the grid on Schedule, the
timeline on Overview, the months on My calendar). Everything else rests at 1 or below;
3 and 4 belong to things that float above the page.

In dark mode elevation **inverts its mechanism rather than its values**: a drop shadow on a
`#0b0e13` canvas is invisible because there is no light for it to block, so every rung
leads with a lit top edge and the shadow only deepens the separation beneath.

### 2. The sky is a separate colour family

The clocks in the header carry the state of their own sky — night deep and cold, dawn and
dusk warm, daytime light — computed by `skyPhase`, which lives beside `nightBands` and
shares its constants so the header and Overview's axis cannot disagree about what night is.

`--sky-*` is deliberately **not** part of the semantic palette. This file's doctrine is that
colour carries meaning and only meaning: amber is attention, red is a gap. A warm sunset
drawn in `--warn` would read as a warning about Chicago. Sky colours appear nowhere a
semantic colour can, and vice versa. The sky never carries anything alone either — the
phase is named in the `title`, and the selected zone is marked by a ring and a lift rather
than a wash of accent, so choosing London does not paint over the fact that it is night
there.

This is not astronomy and must not become it. `skyPhase` knows neither latitude nor season.
A solar calculation would put sunrise in Reykjavik at 03:00 in June, which tells a planner
in Chicago nothing they can use.

### 3. Only the grid is full-bleed

My calendar is `clamp(340px, 40vw, 560px)` and centred; Requests caps at 880px. The
planning grid keeps the whole width and earns it — eighty rows and a horizontal axis. It
reads as *the instrument* precisely because it is the only screen that does.

### 4. One page header, and a scale behind it

`ui/PageHeader.tsx`: `h1` + one line of context + a slot for actions. Deliberately compact,
because Overview and Schedule fit themselves to the viewport and hand the rest of their
height to a timeline or a grid.

The type scale is declared as `--fs-*` in `:root` and exported to Tailwind's `text-*` family
from `@theme inline`. The names differ on purpose: a `@theme` entry that references a
`:root` property of its own name is a circular reference that resolves to nothing, silently.

### 5. Focus mode drains saturation, and nothing else

While a draft is open the chrome desaturates. **Saturation only.** Nothing moves, collapses
or becomes unreachable: somebody mid-edit is the last person who should have to hunt for a
control that quietly went away, and the issue panel is what they are editing *against*, so
it stays at full strength. The draft pill is exempt — dimming the indicator for the mode is
a joke the user does not get to be in on.

### 6. Narrow viewports get a design, not fewer controls

The clock strip becomes one clock plus a popover; the issue panel becomes a drawer. Neither
is removed, only moved. `useMediaQuery` rather than a Tailwind breakpoint, because the
narrow answer is a *different control*, and rendering both while hiding one would mount two
issue panels with two scroll positions fighting over one piece of state.

### 7. Success gets a channel

Failure had three surfaces — the Schedule banner, the "Not saved — retrying" pill, the
`beforeunload` guard — and success had none. Publishing, approving and saving a batch of
settings were confirmed only by something disappearing, which is indistinguishable from
never having been sent. `ui/toasts.ts` plus one `ToastViewport`, with `role="status"` for
success and `role="alert"` for failure: before this the app had no live region anywhere, so
assistive technology was told nothing at all.

The toast does **not** replace the three failure surfaces. A failed publish keeps its
banner, because that message has to stay on screen beside the draft it is about. It also
does not contradict `api/admin.ts`'s "field-by-field, instead of a generic toast": field
errors stay at their fields, and the toast reports the outcome of the batch.

Toasts are raised from `features`, never from `store` — the layering runs
`features → store → api → data → engine → domain`, and `store` reaching up into `ui` would
be the first edge going the wrong way.

## Consequences

- `--ink-faint` moves from `#98a1b0` (≈2.7:1 on white, failing WCAG AA) to a passing value.
  107 usages get darker; that is the point, since they include the primary "right-click to
  edit" instruction.
- There is now one class component in the codebase, `ui/ErrorBoundary.tsx`.
  `getDerivedStateFromError` has no hook equivalent, and forty lines is cheaper than a
  dependency.
- jsdom implements no media engine, so `vitest.setup.ts` polyfills `matchMedia` against
  `window.innerWidth`. A flat `false` would claim every viewport is narrow and silently move
  the whole suite onto the small-screen layout.
- Older literal paddings and text sizes remain in screens this phase did not touch. They
  migrate as each screen is next edited; a single sweep would be a large diff of pure churn
  across files with no other reason to change.
