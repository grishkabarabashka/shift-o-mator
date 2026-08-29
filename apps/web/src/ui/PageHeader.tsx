/**
 * NOTE: the title block every screen wears (ADR-0056).
 *
 * WHY it exists: Overview, Schedule and Requests had no `h1` at all, while People,
 * Settings and My calendar each grew their own — three different sizes, three different
 * arrangements of title, count and search. A screen with no heading is not just a
 * typographic gap; it is a document with no first line, and the eye starts wherever the
 * densest thing happens to be.
 *
 * Deliberately compact. Overview and Schedule fit themselves to the viewport and give the
 * rest of their height to a timeline or a grid, so a tall masthead here would be taken
 * straight out of the work. One row, and the context sits beside the title rather than
 * under it.
 */

import type { ReactNode } from 'react';

export function PageHeader({
  title,
  context,
  children,
}: {
  readonly title: string;
  /** One line saying what this screen is showing right now — the unit in scope, the period,
   *  a count. Not a description of the feature: the tab above already named it. */
  readonly context?: ReactNode;
  /** Actions, pushed to the trailing edge. */
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-xl font-semibold">{title}</h1>
      {context ? <span className="text-xs text-muted">{context}</span> : null}
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
    </header>
  );
}
