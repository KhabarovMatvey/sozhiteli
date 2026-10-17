#!/bin/sh
# Создаёт deploy/production/.env со случайными паролями. Запускается один раз
# на сервере:  sh scripts/init-secrets.sh сайт.ru
#
# Повторный запуск ничего не меняет: пароли уже записаны в базы при первом
# старте, и их замена в .env сломала бы подключение.
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
    echo ".env уже существует - пароли не меняются. Чтобы сменить домен, отредактируйте DOMAIN в .env."
    exit 0
fi

domain="${1:-}"
if [ -z "$domain" ]; then
    echo "Использование: sh scripts/init-secrets.sh <домен>" >&2
    echo "Пример:        sh scripts/init-secrets.sh sozhiteli.ru" >&2
    exit 2
fi
case "$domain" in
    http://* | https://* | */*)
        echo "Домен указывается без https:// и без пути, например sozhiteli.ru" >&2
        exit 2
        ;;
esac

# 32 случайных байта в hex: только [0-9a-f], безопасно для URL и shell.
secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

umask 077
cat > .env <<EOF
# Создано scripts/init-secrets.sh $(date -u +%Y-%m-%dT%H:%M:%SZ). Не публиковать.
DOMAIN=$domain

POSTGRES_SUPERUSER_PASSWORD=$(secret)
PROFILE_MIGRATOR_PASSWORD=$(secret)
PROFILE_APP_PASSWORD=$(secret)
MATCHING_MIGRATOR_PASSWORD=$(secret)
MATCHING_APP_PASSWORD=$(secret)
INTERACTION_MIGRATOR_PASSWORD=$(secret)
INTERACTION_APP_PASSWORD=$(secret)
KEYCLOAK_DB_PASSWORD=$(secret)
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=$(secret)
MATCHING_CLIENT_SECRET=$(secret)

BACKUP_DIR=/var/backups/sozhiteli
BACKUP_KEEP_DAYS=14
EOF

echo "Создан .env (права 600) для https://$domain"
echo "Пароль администратора Keycloak: строка KEYCLOAK_ADMIN_PASSWORD в .env"
echo "Сохраните копию .env в надёжном месте: без неё резервные копии не восстановить на новом сервере."
