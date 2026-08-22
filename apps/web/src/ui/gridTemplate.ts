/**
 * WHY: `var(--name-w) repeat(n, var(--cell-w))` — built once here rather than
 * copied separately into the grid and the coverage strip. The string used to
 * be duplicated, and every edit required remembering both places.
 */
export function columnsTemplate(count: number): string {
  return `var(--name-w) repeat(${count}, var(--cell-w))`;
}
