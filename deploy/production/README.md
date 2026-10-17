# Размещение на сервере (Cloud.ru Evolution)

Всё для публичного запуска лежит в этой папке. Схема — одна виртуальная машина с Docker Compose:

```
Интернет ──443/80──► Caddy (HTTPS, Let's Encrypt)
                       ├─ /        ► web (Next.js)
                       ├─ /api/*   ► edge (nginx) ► profile · matching · interaction
                       └─ /id/*    ► Keycloak (вход и регистрация)
                                       все ► PostgreSQL (внутренняя сеть, наружу закрыта)
```

Сайт, API и вход живут на одном домене (`https://домен`, `https://домен/api`, `https://домен/id`).
Консоль администратора Keycloak снаружи закрыта — вход в неё через SSH-туннель.

| Файл | Что это |
|---|---|
| `compose.yaml` | Все контейнеры промышленной среды |
| `Caddyfile` | HTTPS и маршрутизация |
| `keycloak/realm.json` | Realm без тестовых пользователей; адрес и секрет подставляются из `.env` |
| `edge/00-real-ip.conf` | Настоящий IP клиента для ограничения частоты запросов |
| `scripts/init-secrets.sh` | Создаёт `.env` со случайными паролями |
| `scripts/keycloak-admin-setup.sh` | Однократная настройка входа в консоль администратора |
| `scripts/backup.sh`, `scripts/restore.sh` | Резервная копия всех баз и восстановление |
| `pack.mjs` | Упаковка проекта на своём компьютере для загрузки на сервер |

## 1. Что понадобится

- **Виртуальная машина** в Cloud.ru Evolution (сервис Compute): Ubuntu 24.04, **2 vCPU, 4 ГБ
  памяти**, диск от 30 ГБ, **публичный IP**. Вся система занимает около 0,9 ГБ памяти; остальное —
  запас на сборку и пики. С 2 ГБ тоже заработает, если собирать образы не на сервере (вариант Б).

  **Бесплатный тариф (free tier).** Памяти и диска хватает, но гарантирована только малая доля
  процессора (по открытым источникам — около 10%). Поэтому на нём: образы собирать **у себя**
  (вариант Б), а первый запуск Keycloak может занять до 5–10 минут. Для учебного эксперимента
  на десятки человек этого достаточно; если страницы станут заметно медленными — тариф с
  гарантированным процессором.
- **Группа безопасности** ВМ — входящие: TCP 22 (лучше только со своего IP), TCP 80, TCP 443,
  UDP 443. Остальное закрыто. Docker публикует наружу только 80 и 443.
- **Домен** с A-записью на публичный IP ВМ (у регистратора домена или в DNS Cloud.ru). Проверка:
  `ping домен` отвечает адресом ВМ. Без этого HTTPS-сертификат не выпустится.

  Своего домена нет — можно временно взять адрес сервиса sslip.io, который сам указывает на ваш IP:
  для IP `203.0.113.7` домен — `203-0-113-7.sslip.io`. Let's Encrypt выдаёт на него сертификат.
  Для показа и эксперимента подойдёт; адрес некрасивый и зависит от стороннего сервиса.

Названия разделов консоли Cloud.ru могут отличаться от приведённых — сверяйтесь с их документацией.

## 2. Подготовка сервера

Подключитесь по SSH (`ssh user@IP`) и установите Docker с плагином Compose из официального
репозитория Docker:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
```

Если `download.docker.com` недоступен — пакеты из репозитория Ubuntu:
`sudo apt-get install -y docker.io docker-compose-v2`.

Docker запускается при загрузке ВМ, а контейнеры — `restart: unless-stopped`, поэтому после
перезагрузки сервера сайт поднимется сам.

## 3. Загрузка проекта

На **своём компьютере**, в корне репозитория:

```bash
node deploy/production/pack.mjs
scp deploy/production/out/sozhiteli-src-*.tar.gz user@IP:/tmp/
```

В архив (около 0,3 МБ) попадает только нужное для запуска: без `node_modules`, без `research/`
(сведения о респондентах) и без локальных `.env`.

На **сервере**:

```bash
sudo mkdir -p /opt/sozhiteli
sudo tar -xzf /tmp/sozhiteli-src-*.tar.gz -C /opt/sozhiteli
cd /opt/sozhiteli/deploy/production
```

## 4. Первый запуск

```bash
sudo sh scripts/init-secrets.sh ваш-домен.ru
```

Скрипт создаёт `.env` со случайными паролями (права 600). **Сохраните копию `.env` в надёжном
месте** (менеджер паролей): без него резервные копии не восстановить на новом сервере.

Дальше — один из двух вариантов.

**Вариант А — сборка на сервере** (проще; нужен доступ к Docker Hub, quay.io и gcr.io):

```bash
sudo docker compose up -d --build
```

Первая сборка — 5–10 минут.

**Вариант Б — образы собираются на своём компьютере.** Подходит, если сервер не может скачать
базовые образы или в нём мало памяти. На своём компьютере (нужен Docker):

```bash
node deploy/production/pack.mjs --images --domain ваш-домен.ru
scp deploy/production/out/sozhiteli-images-*.tar.gz user@IP:/tmp/
```

Архив образов — около 530 МБ. Домен вшивается в сборку web, поэтому при смене домена образы
собираются заново. На сервере:

```bash
sudo docker load -i /tmp/sozhiteli-images-*.tar.gz
sudo docker compose up -d --no-build
```

**После запуска** (любой вариант):

```bash
sudo docker compose ps                     # все сервисы healthy, миграции Exited (0)
sudo sh scripts/keycloak-admin-setup.sh    # один раз: вход в консоль администратора
```

Откройте `https://ваш-домен.ru`: первый запрос занимает несколько секунд, пока Caddy получает
сертификат. Зарегистрируйтесь, заполните анкету, проверьте обмен контактами двумя учётными
записями.

Демо-анкеты (`npm run demo:seed`) работают только с локальной средой и на сервер не попадают.

## 5. Администрирование Keycloak

Консоль закрыта снаружи. Со своего компьютера откройте туннель и не закрывайте окно:

```bash
ssh -L 8081:127.0.0.1:8081 user@IP
```

Затем откройте в браузере http://localhost:8081/id/admin/. Логин и пароль — `KEYCLOAK_ADMIN_USERNAME`
и `KEYCLOAK_ADMIN_PASSWORD` из `.env`. Keycloak помечает этого администратора как временного:
создайте в realm `master` своего постоянного администратора, а временного удалите.

Пользователи сервиса — realm `sozhiteli` → Users. Удаление данных пользователя по его просьбе —
`docs/SECURITY.md`, раздел «Удаление данных пользователя».

## 6. Резервные копии

```bash
sudo sh scripts/backup.sh
```

Скрипт делает дамп четырёх баз (анкеты, выдача, запросы и контакты, учётные записи) в
`/var/backups/sozhiteli/<дата-время>/`, проверяет, что каждый файл читается, и удаляет копии
старше 14 дней (`BACKUP_KEEP_DAYS` в `.env`).

Ежедневно в 03:30 — файл `/etc/cron.d/sozhiteli-backup`:

```
30 3 * * * root sh /opt/sozhiteli/deploy/production/scripts/backup.sh >> /var/log/sozhiteli-backup.log 2>&1
```

Копии лежат на том же диске, что и база: от ошибочного удаления данных они защищают, от потери ВМ —
нет. Регулярно забирайте их с сервера (`scp -r user@IP:/var/backups/sozhiteli ./`) или включите
снимки диска в консоли Cloud.ru.

Восстановление (данные всех баз заменяются копией; скрипт спросит подтверждение):

```bash
sudo sh scripts/restore.sh /var/backups/sozhiteli/20261017-033000
```

На новом сервере: тот же `.env`, шаги 2–4, затем `restore.sh`.

## 7. Обновление версии

На своём компьютере снова `node deploy/production/pack.mjs` и `scp`, на сервере:

```bash
cd /opt/sozhiteli/deploy/production
sudo sh scripts/backup.sh
sudo tar -xzf /tmp/sozhiteli-src-НОВЫЙ.tar.gz -C /opt/sozhiteli
sudo docker compose up -d --build          # или docker load + up -d --no-build
```

`.env` в архив не входит и не перезаписывается. Миграции баз выполняются при запуске
автоматически. Изменения `keycloak/realm.json` к уже созданному realm **не применяются** (импорт
пропускает существующий realm) — их вносят в консоли администратора.

## 8. Диагностика

```bash
sudo docker compose ps                     # состояние
sudo docker compose logs -f caddy          # HTTPS и входящие запросы
sudo docker compose logs -f keycloak       # вход и регистрация
sudo docker compose logs --tail 100 matching
```

| Симптом | Причина |
|---|---|
| Браузер пишет, что сертификат недействителен | A-запись ещё не указывает на ВМ или закрыты порты 80/443; смотрите `logs caddy` |
| «Не удалось связаться с сервером» сразу после запуска | Keycloak стартует до минуты; дождитесь `healthy` |
| `docker compose up --build` не скачивает образы | Нет доступа к реестрам — вариант Б |
| `scp` обрывается, SSH подвисает, а `ping` до сервера отвечает за <1 мс | Трафик идёт через VPN или прокси на вашем компьютере. Добавьте IP сервера в исключения VPN или отключите VPN на время загрузки |
| Let's Encrypt пишет `Timeout during connect` | В группе безопасности не открыты входящие TCP 80 и 443 |
| Matching пишет `profile sync failed` первые секунды | Keycloak ещё запускается; синхронизация повторится сама |

## 9. Мобильное приложение

Для сборки под этот сервер в `apps/mobile/.env`:

```
EXPO_PUBLIC_API_BASE_URL=https://ваш-домен.ru
EXPO_PUBLIC_OIDC_ISSUER=https://ваш-домен.ru/id/realms/sozhiteli
EXPO_PUBLIC_OIDC_CLIENT_ID=sozhiteli-mobile
```

Сборка для магазинов приложений в эту папку не входит. На устройстве приложение пока не проверялось
(`docs/BACKLOG.md`, MB-00).

## 10. Что остаётся за владельцем продукта

- **Персональные данные.** Сервис хранит почту, имя, год рождения и контакты. До прихода реальных
  людей нужны согласие на обработку и политика конфиденциальности; данные хранятся в России
  (Cloud.ru), но юридическую сторону это целиком не закрывает.
- **Почта.** Сброс пароля и подтверждение почты выключены: для них нужен SMTP. Подключается в
  консоли администратора: realm `sozhiteli` → Realm settings → Email, затем вкладка Login.
- **Мониторинг.** Есть только состояние контейнеров и логи. Внешнюю проверку доступности сайта
  можно добавить любым сервисом мониторинга.
- **Одна ВМ.** Отказ ВМ — простой до восстановления из копии. Для учебного эксперимента это
  допустимо (`docs/SCALING_PLAN.md`, этап 1).
