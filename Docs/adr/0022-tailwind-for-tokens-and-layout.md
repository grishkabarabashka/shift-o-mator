# ADR-0022. Tailwind CSS v4 for tokens and layout; Radix stays for behavior

**Status:** accepted — amends [ADR-0013](0013-headless-ui-layer.md)

## Context

The first shell was hand-written CSS over Radix primitives. It worked, and it looked
like a database admin tool: uniform density everywhere, no spacing scale, no separation
between chrome and data. The owner's verdict on seeing it was that the interface was
unpleasant to read information from and asked for a modern, lightweight library and a
more open design.

Two things were tangled in that request and have to be separated, because only one of
them is a library problem:

- **Look and rhythm.** Real: there was no spacing or type scale, so every hand-written
  rule invented its own numbers, and the result had no visual hierarchy.
- **Usability.** Also real, but nothing to do with styling: the grid lagged, the
  right-click menu was disabled outside edit mode, and there was no date-range control
  at all. A component library fixes none of these. They are addressed separately
  ([ADR-0023](0023-editing-arms-itself.md) and the grid rewrite).

## Decision

Adopt **Tailwind CSS v4** via `@tailwindcss/vite`, and keep Radix for behavior.

Design tokens live in `:root` as ordinary custom properties and are exposed to Tailwind
through `@theme inline`. Dark mode redefines the properties in one block; no utility
table is duplicated.

Distinctive widgets — the planning grid, coverage strip, day strip, year scrubber,
timeline lanes, heatmap — stay as component classes in `theme.css` and `grid.css`.
Tailwind utilities are used for page and card layout, where they earn their keep.

## Consequences

- One spacing, type and radius scale across every screen, which is what the "airy"
  request actually needed. Chrome breathes; the grid stays dense on purpose.
- No runtime and no component ownership: [ADR-0013](0013-headless-ui-layer.md) holds.
  Swapping Radix for a corporate component library still touches `ui/primitives.tsx`
  and the component classes, not every page.
- **Class-name collisions are now a real hazard.** Tailwind ships `grid` and `table` as
  utilities; the grid root and the settings tables used exactly those names, and
  `.grid { min-width: 100% }` silently stretched every element carrying the Tailwind
  `grid` utility — the product logo among them. Component classes are named `sheet`
  and `rows` instead. Any new component class must be checked against the utility
  namespace.
- CSS output is ~35 kB, 8 kB gzipped, and only grows with utilities actually used.

## Alternatives considered

- **A full component library (Mantine, Chakra).** Would deliver a polished look
  immediately and cut code. Rejected on two counts: the widgets this product is
  actually judged on — day strip, 24-hour minibar, coverage row, timeline lanes — come
  from no library and would have to be hand-built anyway, so the library would style
  only the easy half; and owning components conflicts with ADR-0013's whole reason for
  existing, a cheap swap to the corporate design system.
- **Keep hand-written CSS, add a token scale.** Achievable, and roughly what the token
  block does. Rejected because the utility layer is what stops the next page from
  inventing `padding: 13px` again.
