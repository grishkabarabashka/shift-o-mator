/**
 * Текущий момент, обновляемый раз в минуту.
 *
 * Маркер «сейчас» на таймлайне обязан двигаться: замерший на времени загрузки
 * страницы, он врёт тем убедительнее, чем дольше вкладка открыта, — а именно
 * по нему дежурный отвечает на вопрос «кто на смене».
 *
 * Раз в минуту, а не чаще: шаг оси — час, и более частый тик перерисовывал бы
 * дорожки без единого видимого пикселя разницы.
 */

import { useEffect, useState } from 'react';
import type { IsoInstant } from '../domain/types.ts';

const MINUTE = 60_000;

export function useNow(intervalMs: number = MINUTE): IsoInstant {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
