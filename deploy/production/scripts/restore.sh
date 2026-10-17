#!/bin/sh
# Восстановление всех баз из резервной копии scripts/backup.sh.
#   sh scripts/restore.sh /var/backups/sozhiteli/20261017-033000
#
# Текущие данные баз ЗАМЕНЯЮТСЯ данными копии. Сервисы на время
# восстановления останавливаются и затем запускаются снова.
# На новом сервере: тот же .env (пароли ролей), `docker compose up -d`,
# затем этот скрипт.
set -eu

cd "$(dirname "$0")/.."
. ./.env

source_dir="${1:-}"
if [ -z "$source_dir" ] || [ ! -d "$source_dir" ]; then
    echo "Использование: sh scripts/restore.sh <каталог резервной копии>" >&2
    exit 2
fi
backup_dir="${BACKUP_DIR:-/var/backups/sozhiteli}"
name="$(basename "$source_dir")"
# Внутри контейнера PostgreSQL виден только $BACKUP_DIR (смонтирован в /backups).
if [ ! -f "$backup_dir/$name/profile_db.dump" ]; then
    echo "Нет $backup_dir/$name/profile_db.dump: копия должна лежать в $backup_dir" >&2
    exit 2
fi

compose() { docker compose --env-file .env -f compose.yaml "$@"; }

printf 'Данные всех баз будут заменены копией %s. Продолжить? [да/нет] ' "$name"
read -r answer
[ "$answer" = "да" ] || { echo "Отменено."; exit 1; }

compose stop caddy web edge profile matching interaction keycloak

for db in profile_db matching_db interaction_db keycloak_db; do
    echo "Восстановление $db"
    compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
        pg_restore -h 127.0.0.1 -U postgres -d "$db" --clean --if-exists --exit-on-error \
        "/backups/$name/$db.dump"
done

compose up -d
echo "Готово. Проверка: docker compose ps (все сервисы healthy)."
