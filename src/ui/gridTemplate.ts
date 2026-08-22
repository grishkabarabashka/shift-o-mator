/**
 * `var(--name-w) repeat(n, var(--cell-w))` — построено один раз здесь, а не
 * скопировано отдельно в сетку и в полосу покрытия. Раньше строка была
 * продублирована, и любая правка требовала помнить оба места.
 */
export function columnsTemplate(count: number): string {
  return `var(--name-w) repeat(${count}, var(--cell-w))`;
}
