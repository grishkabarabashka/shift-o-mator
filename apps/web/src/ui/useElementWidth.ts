/**
 * Живая ширина элемента, через `ResizeObserver`.
 *
 * Зум задаёт масштаб таймлайна и сетки, а не лимит на то, сколько дней
 * показывать (Phase 0 интерфейсного ревью): «День» должен растянуть один день
 * на весь экран, «Неделя» — неделю. И полоса покрытия, и хитмап, и таймлайн
 * Overview сводятся к одному вопросу — «сколько у меня пикселей» — так что
 * это один хук, а не отдельный `ResizeObserver` в каждом компоненте.
 *
 * Callback-ref, не `useRef` — когда узел, на который указывает ref, меняется
 * (например, DateRangeControl разворачивает панель и React монтирует другой
 * `<div>` на этом месте дерева), `useRef` не даёт эффекту это заметить: он
 * запускается один раз при монтировании и навсегда остаётся привязан к
 * первому узлу, даже когда тот уже удалён из DOM. Наблюдатель молча следит за
 * отсоединённым узлом, а `width` замирает на последнем известном значении —
 * ровно тот сценарий, что даёт «полоса дней мигнула и пропала» при
 * сворачивании/разворачивании панели периода.
 */

import { useCallback, useRef, useState } from 'react';

export function useElementWidth<T extends HTMLElement>(): readonly [
  (node: T | null) => void,
  number,
] {
  const observerRef = useRef<ResizeObserver>(undefined);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = undefined;
    if (!node) return;

    setWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, width] as const;
}
