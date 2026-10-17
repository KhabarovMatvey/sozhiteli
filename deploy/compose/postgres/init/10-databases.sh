#!/bin/sh
# Создаёт изолированные базы данных и роли. Выполняется один раз, при первой
# инициализации тома PostgreSQL.
#
# Для каждого сервиса:
#   <svc>_db        - отдельная база данных; запросы между базами в PostgreSQL
#                     невозможны, поэтому сервис физически не может прочитать
#                     чужие таблицы;
#   <svc>_migrator  - владелец схемы, используется только командой миграций;
#   <svc>_app       - роль работающего сервиса: только чтение и запись строк,
#                     без права менять схему.
set -eu

create_service_database() {
    name="$1"
    migrator_password="$2"
    app_password="$3"

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
        -v db="${name}_db" -v migrator="${name}_migrator" -v app="${name}_app" \
        -v migrator_password="$migrator_password" -v app_password="$app_password" <<'SQL'
CREATE ROLE :"migrator" LOGIN PASSWORD :'migrator_password';
CREATE ROLE :"app" LOGIN PASSWORD :'app_password';
CREATE DATABASE :"db" OWNER :"migrator";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app";
SQL

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${name}_db" \
        -v migrator="${name}_migrator" -v app="${name}_app" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL
}

create_service_database profile "$PROFILE_MIGRATOR_PASSWORD" "$PROFILE_APP_PASSWORD"
create_service_database matching "$MATCHING_MIGRATOR_PASSWORD" "$MATCHING_APP_PASSWORD"
create_service_database interaction "$INTERACTION_MIGRATOR_PASSWORD" "$INTERACTION_APP_PASSWORD"

# Keycloak сам управляет своей схемой, ему достаточно одной роли-владельца.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE keycloak_app LOGIN PASSWORD :'password';
CREATE DATABASE keycloak_db OWNER keycloak_app;
REVOKE ALL ON DATABASE keycloak_db FROM PUBLIC;
SQL
