#!/bin/sh
# Резервная копия всех баз: по файлу pg_dump (формат custom) на базу.
#   sh scripts/backup.sh
# Каталог копии: $BACKUP_DIR/<дата-время>/ ; копии старше BACKUP_KEEP_DAYS
# дней удаляются. Для запуска по расписанию - cron (README.md, раздел «Размещение на сервере»).
#
# Копия лежит на том же диске, что и база: от ошибки или удаления данных она
# защищает, от потери сервера - нет. Копируйте каталог за пределы сервера.
set -eu

cd "$(dirname "$0")/.."
. ./.env

backup_dir="${BACKUP_DIR:-/var/backups/sozhiteli}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%d-%H%M%S)"

compose() { docker compose --env-file .env -f compose.yaml "$@"; }

mkdir -p "$backup_dir"
compose exec -T postgres mkdir -p "/backups/$stamp"

for db in profile_db matching_db interaction_db keycloak_db; do
    compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
        pg_dump -h 127.0.0.1 -U postgres -Fc -f "/backups/$stamp/$db.dump" "$db"
done

# Проверка: каждый файл читается pg_restore (оглавление архива не пустое).
for db in profile_db matching_db interaction_db keycloak_db; do
    compose exec -T postgres pg_restore -l "/backups/$stamp/$db.dump" > /dev/null
done

chmod 700 "$backup_dir/$stamp"
echo "Резервная копия: $backup_dir/$stamp"
du -sh "$backup_dir/$stamp" 2>/dev/null || true

find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -mtime "+$keep_days" -exec rm -rf {} +
