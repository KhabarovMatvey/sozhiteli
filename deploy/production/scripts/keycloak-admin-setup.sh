#!/bin/sh
# Однократная настройка администрирования Keycloak после первого запуска:
#   sh scripts/keycloak-admin-setup.sh
#
# Консоль администратора и master realm снаружи закрыты (Caddyfile). Чтобы
# войти в консоль через SSH-туннель, страницы входа master realm должны
# строиться от адреса туннеля, а не от публичного домена - это задаёт
# Frontend URL master realm. Заодно включается защита от перебора паролей.
# Повторный запуск безопасен.
set -eu

cd "$(dirname "$0")/.."
. ./.env

compose() { docker compose --env-file .env -f compose.yaml "$@"; }

# Пароль передаётся через stdin, а не аргументом: так он не виден в списке процессов.
printf '%s\n' "$KEYCLOAK_ADMIN_PASSWORD" | compose exec -T keycloak sh -c '
    read -r password
    /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/id \
        --realm master --user "$0" --password "$password"
' "$KEYCLOAK_ADMIN_USERNAME"

compose exec -T keycloak /opt/keycloak/bin/kcadm.sh update realms/master \
    -s 'attributes.frontendUrl=http://localhost:8081/id' \
    -s bruteForceProtected=true

echo "Готово. Консоль: SSH-туннель (README.md, «Размещение на сервере») и http://localhost:8081/id/admin/"
