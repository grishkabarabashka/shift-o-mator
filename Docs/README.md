# Документация shift-o-mator

Планирование и визуализация смен глобальной команды application support.

## Разделы

| Файл | Содержание |
|---|---|
| [00-overview.md](00-overview.md) | Задача, что не так с текущим Excel, пользователи и сценарии, границы |
| [01-domain-model.md](01-domain-model.md) | Сущности: planning unit, location, role, person, assignment, absence, comp day, правила |
| [02-time.md](02-time.md) | Хранение и отображение времени, таймзоны, DST, overlap |
| [03-validation.md](03-validation.md) | Три уровня серьёзности нарушений и поведение системы |
| [04-screens.md](04-screens.md) | Timeline, сетка планирования, absence overview, аналитика, настройки |
| [05-generation.md](05-generation.md) | Автогенерация: жёсткие и мягкие ограничения, объяснимость |
| [06-integrations.md](06-integrations.md) | Импорт отпусков, обратный поток, ICS, экспорт |
| [07-collaboration.md](07-collaboration.md) | Блокировка периода, права |
| [08-architecture.md](08-architecture.md) | Стек, визуальный слой, сетка, масштаб, граница данных |
| [09-roadmap.md](09-roadmap.md) | Двенадцать этапов и что даёт каждый |
| [10-open-questions.md](10-open-questions.md) | Вопросы к владельцу, требующие реальных данных |

## Решения

[adr/](adr/) — четырнадцать принятых архитектурных решений. Каждое снимает конкретную
проблему; пересмотр только через явное обсуждение и новый ADR со статусом
«отменяет ADR-NNNN».

| ADR | Решение |
|---|---|
| [0001](adr/0001-role-carries-time.md) | Роль несёт своё время |
| [0002](adr/0002-location-is-calendar-only.md) | Локация отвечает только за календарь и отображение |
| [0003](adr/0003-planning-unit-not-geography.md) | Planning unit — организационная, а не географическая граница |
| [0004](adr/0004-roles-belong-to-unit.md) | Роли принадлежат единице; глобального справочника нет |
| [0005](adr/0005-no-work-pattern-entity.md) | Отдельной сущности «рабочий паттерн» нет |
| [0006](adr/0006-eligibility-target-shares.md) | Eligibility хранит целевые доли, а не булевы флаги |
| [0007](adr/0007-comp-day-as-balance.md) | Comp day — начисление с балансом |
| [0008](adr/0008-events-are-dated-coverage-rules.md) | События — это правила покрытия с датой |
| [0009](adr/0009-three-severity-levels.md) | Три уровня валидации; мягкие правила не блокируют |
| [0010](adr/0010-absence-limits-by-role-pool.md) | Лимиты отсутствий и по единице, и по пулу ролей |
| [0011](adr/0011-checkout-instead-of-realtime.md) | Блокировка периода через check-out, без real-time |
| [0012](adr/0012-schedule-repository-boundary.md) | `ScheduleRepository` — единственная граница данных |
| [0013](adr/0013-headless-ui-layer.md) | Headless UI-слой ради дешёвой замены оболочки |
| [0014](adr/0014-own-grid-and-timeline.md) | Timeline и сетка пишутся самостоятельно |
