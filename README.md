
## Архитектура в двух словах

```
Web (Next.js) ─┐                       ┌─► Profile      ─► profile_db
               ├─► Edge (nginx) ───────┼─► Matching     ─► matching_db
Mobile (Expo) ─┘        │              └─► Interaction  ─► interaction_db
        │               │                      ▲
        └─► Keycloak (OIDC)          Matching ─┘ читает ленту изменений Profile (фоново)
```

Три независимо развёртываемых сервиса на Go, у каждого своя база данных и роли; вход — через
готовый OIDC-провайдер; контракты — OpenAPI, из которых генерируются сервер и клиент.
Схемы, сценарии и модель отказов — `docs/ARCHITECTURE.md`.

## Быстрый старт

Требуется: **Docker** (с Compose), **Node.js 24**, **Go 1.27**.

Всё сразу — сервисы, Keycloak и web-приложение в контейнерах:

```bash
npm install          # зависимости web, mobile и инструментов
npm run setup        # создать .env из шаблонов (только значения для разработки)
npm run app:up       # собрать образы и поднять всё, включая web на http://localhost:3000
npm run demo:seed    # 60 демо-анкет в шести городах, чтобы было кого смотреть
```

Откройте http://localhost:3000, нажмите «Войти» → «Зарегистрироваться» (почта и пароль), заполните
анкету — выдача построится по вашим условиям. Демо-анкеты — не люди: на запрос контакта они не
ответят. Чтобы проверить обмен контактами, войдите двумя тестовыми пользователями в разных
браузерах. Убрать демо-анкеты: `npm run demo:clean`.

Для разработки web — вместо контейнера сервер с горячей перезагрузкой:

```bash
npm run infra:up     # PostgreSQL, Keycloak, три сервиса и edge (без web-контейнера)
npm run infra:smoke  # сквозные проверки: маршрутизация, вход, изоляция данных, синхронизация
npm run web:dev      # web-приложение на http://localhost:3000
```

| Адрес | Что |
|---|---|
| http://localhost:3000 | Web-приложение |
| http://localhost:8080/api/{profile,matching,interaction}/ | API через edge-прокси |
| http://localhost:8081 | Keycloak (страницы входа на русском — ADR-0013) |

Тестовые пользователи локальной среды описаны в `deploy/compose/keycloak/realm-dev.json`;
учётная запись администратора Keycloak — в `deploy/compose/.env`.

Размещение на сервере (Cloud.ru или любая ВМ с Docker): [`deploy/production/README.md`](deploy/production/README.md).

Остановить: `npm run infra:down`. Остановить и стереть данные: `npm run infra:reset`.

Изменения `realm-dev.json` применяются к работающему Keycloak только после `npm run infra:reset`
(импорт пропускает существующий realm, ADR-0013).

Мобильное приложение: `npm run mobile:start`. Вход использует схему `sozhiteli://`, поэтому нужен
development build, а не Expo Go; для эмулятора Android — проброс портов, см.
`apps/mobile/.env.example`. На устройстве приложение **не проверялось** (`docs/VERIFICATION.md`).
Быстро посмотреть экраны в браузере: `npm run web -w @sozhiteli/mobile` (http://localhost:8082;
вход открывается во всплывающем окне).

## Проверки

| Команда | Что проверяет |
|---|---|
| `npm run contracts:lint` | OpenAPI-контракты |
| `npm run gen` | Перегенерация кода из контрактов и SQL |
| `npm run backend:fmt` · `backend:vet` · `backend:lint` · `backend:tidy` | Статические проверки Go |
| `npm run backend:test` | Юнит- и контрактные тесты |
| `npm run backend:test:integration` | Все тесты, включая интеграционные на временном PostgreSQL |
| `npm run lint` · `typecheck` · `test` · `format:check` | TypeScript: web, mobile, клиент API |
| `npm run web:build` | Сборка web |
| `npm run doctor -w @sozhiteli/mobile` | Конфигурация Expo |
| `npm run infra:smoke` | Сквозная проверка запущенной среды |
| `npm run load:smoke` · `load:baseline` | Нагрузочные сценарии k6: платформа |
| `npm run load:seed` → `load:product` → `load:clean` | Нагрузка на продуктовые операции на 10 000 анкет |
| `npm run metrics` | Метрики эксперимента M1–M4 (`docs/EXPERIMENT_QUERIES.md`); демо-анкеты не учитываются |
| `npm run demo:seed` · `demo:clean` | Демо-анкеты для локальной среды |

`expo-doctor` нельзя запускать с флагом `npm run -s`: тихий режим передаётся его вложенным
вызовам npm, и три проверки ложно падают.

Что из этого реально выполнено и с каким результатом — `docs/VERIFICATION.md`.

## Структура

```
contracts/openapi/     OpenAPI-контракты: источник истины для API
backend/platform/      общая техническая библиотека Go (без предметной области)
backend/services/      profile · matching · interaction — отдельный Go-модуль и образ на сервис
packages/api-client/   типизированный клиент API для web и mobile (генерируется)
apps/web/              Next.js
apps/mobile/           Expo / React Native
deploy/compose/        локальная среда
tools/                 кроссплатформенные скрипты
tests/load/            сценарии k6
docs/                  документация и ADR
research/              исходные материалы исследования (не в git)
```

## Документация

| Документ | О чём |
|---|---|
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | **С чего начинать исполнителю:** правила, запреты, шаблон постановки задачи |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Задачи с точными правилами и критериями приёмки |
| [`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md) | Гипотеза, эксперимент, что входит и не входит, открытые вопросы |
| [`docs/FEATURE_JUSTIFICATION.md`](docs/FEATURE_JUSTIFICATION.md) | Зачем нужна каждая функция, поле и вопрос анкеты |
| [`docs/RESEARCH_EVIDENCE.md`](docs/RESEARCH_EVIDENCE.md) | Что подтверждено исследованием и чего в нём нет |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | C4, сценарии, модель отказов, план эволюции |
| [`docs/SERVICE_BOUNDARIES.md`](docs/SERVICE_BOUNDARIES.md) | Что делает и чего не делает каждый сервис |
| [`docs/DATA_OWNERSHIP.md`](docs/DATA_OWNERSHIP.md) | Кому принадлежат данные, правила миграций |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | Правила контрактов, ошибки, пагинация, версии |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Модель угроз, правило раскрытия контакта, ограничения |
| [`docs/ENGINEERING_RULES.md`](docs/ENGINEERING_RULES.md) | Версии, команды, правила кода, конфигурация |
| [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) | Уровни тестов и обязательные тесты |
| [`docs/SCALING_PLAN.md`](docs/SCALING_PLAN.md) | SLO-допущения, узкие места, три этапа роста |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Что проверено запуском, а что нет |
| [`docs/adr/`](docs/adr/README.md) | 13 архитектурных решений с альтернативами |

## Что требует решения владельца продукта

Открытые вопросы перечислены в `docs/MVP_SCOPE.md`. Вопрос о городах решён (все города России).
Остаётся важным:

- **Q-2** — пороги успеха эксперимента (без них результат нельзя будет интерпретировать).
