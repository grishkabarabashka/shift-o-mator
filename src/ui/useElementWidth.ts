/**
 * Живая ширина элемента, через `ResizeObserver`.
 *
 * Зум задаёт масштаб таймлайна и сетки, а не лимит на то, сколько дней
 * показывать (Phase 0 интерфейсного ревью): «День» должен растянуть один день
 * на весь экран, «Неделя» — неделю. И полоса покрытия, и хитмап, и таймлайн
 * Overview сводятся к одному вопросу — «сколько у меня пикселей» — так что
 * это один хук, а не отдельный `ResizeObserver` в каждом компоненте.
 */

import { useEffect, useRef, useState } from 'react';

export function useElementWidth<T extends HTMLElement>(): readonly [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    setWidth(node.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
