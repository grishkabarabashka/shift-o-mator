# shift-o-mator

Планирование и визуализация смен глобальной команды application support.

Заменяет ручное планирование в общем Excel-файле: хранит время ролей в системе,
проверяет покрытие непрерывно, считает comp days и справедливость нагрузки.

## Документация

[Docs/](Docs/README.md) — разделы и принятые решения.

## Состояние

MVP без бэкенда. Данные — фикстуры в памяти с персистом в IndexedDB.
Закрыты этапы 1–5 из [плана работ](Docs/09-roadmap.md).

## Запуск

```
npm install
npm run dev
```

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Vite dev-сервер |
| `npm run build` | проверка типов и продакшен-сборка |
| `npm run preview` | просмотр собранного |
| `npm test` | Vitest в watch-режиме |
| `npm run test:run` | Vitest однократно |
| `npm run typecheck` | `tsc --noEmit` |
