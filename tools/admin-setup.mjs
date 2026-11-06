#!/usr/bin/env node
// Только локальная среда: дополняет существующий realm без повторного импорта
// и без сброса базы. Секреты не попадают в вывод или аргументы командной строки.

import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

const base = new URL('http://localhost:8081');
const realm = 'sozhiteli';
const adminRoleName = 'sozhiteli-admin';
const readerClientId = 'profile-admin-reader';
const username = 'adminlocal@example.test';
const ownerAttribute = 'sozhiteliLocalAdminOwner';
const ownerValue = 'tools/admin-setup.mjs:v1';
const envPath = path.join(root, 'deploy/compose/.env');
const credentialsPath = path.join(root, 'research/local-admin.txt');
let token;

class SetupError extends Error {}

function fail(message) {
  throw new SetupError(message);
}

// Ошибки HTTP содержат только название операции и статус, без тела ответа:
// Keycloak может возвращать в нём данные пользователя или параметры входа.
async function request(route, { method = 'GET', json, form, label = 'Keycloak', allow404 } = {}) {
  let response;
  try {
    response = await fetch(new URL(route, base), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(token && !form ? { Authorization: `Bearer ${token}` } : {}),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
    });
  } catch {
    fail(`${label}: локальный Keycloak недоступен. Запустите npm run infra:up и повторите.`);
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) fail(`${label}: HTTP ${response.status}. Тело ответа скрыто.`);
  if (response.status === 204 || !response.headers.get('content-type')?.includes('application/json')) {
    return null;
  }
  return response.json();
}

const api = (route, options) => request(`/admin/realms/${realm}${route}`, options);

function readEnv(source) {
  const entries = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    if (entries.has(match[1])) fail('В локальном .env есть повторяющиеся переменные; исправьте их.');
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  }
  return entries;
}

function checkPrivatePath(file) {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) {
    fail('Секретный локальный файл не должен быть символической ссылкой.');
  }
  const relative = path.relative(realpathSync(root), realpathSync(path.dirname(file)));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('Каталог для локальных секретов должен находиться внутри проекта.');
  }
}

function writePrivate(file, text, { exclusive = false } = {}) {
  checkPrivatePath(file);
  if (exclusive) {
    writeFileSync(file, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } else {
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  }
  chmodSync(file, 0o600);
}

async function findClient(clientId) {
  const clients = await api(`/clients?clientId=${encodeURIComponent(clientId)}`, {
    label: 'Поиск служебного клиента',
  });
  return clients.find((client) => client.clientId === clientId);
}

async function findAdmin() {
  const users = await api(`/users?username=${encodeURIComponent(username)}&exact=true`, {
    label: 'Проверка локальной учётной записи',
  });
  return users.find((user) => user.username === username);
}

async function ensureRoleMapper(client) {
  const mappers = await api(`/clients/${client.id}/protocol-mappers/models`);
  const desired = {
    name: 'realm-roles-access-token',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-realm-role-mapper',
    config: {
      multivalued: 'true',
      'claim.name': 'realm_access.roles',
      'jsonType.label': 'String',
      'access.token.claim': 'true',
      'id.token.claim': 'false',
      'userinfo.token.claim': 'false',
    },
  };
  const existing = mappers.find((mapper) => mapper.name === desired.name);
  await api(`/clients/${client.id}/protocol-mappers/models${existing ? `/${existing.id}` : ''}`, {
    method: existing ? 'PUT' : 'POST',
    json: { ...desired, ...(existing ? { id: existing.id } : {}) },
    label: 'Настройка ролей в access token',
  });
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node tools/admin-setup.mjs — создать отдельного администратора только в локальной среде.');
    return;
  }
  if (process.argv.length !== 2)
    fail('Скрипт не принимает адрес сервера или путь среды. Используйте --help.');
  if (base.protocol !== 'http:' || base.hostname !== 'localhost' || base.port !== '8081') {
    fail('Разрешён только локальный Keycloak localhost:8081.');
  }
  if (!existsSync(envPath)) fail('Нет deploy/compose/.env. Сначала выполните npm run setup.');
  checkPrivatePath(envPath);
  const source = readFileSync(envPath, 'utf8');
  const env = readEnv(source);
  let webOrigin;
  try {
    webOrigin = new URL(env.get('WEB_ORIGIN') || 'http://localhost:3000');
  } catch {
    fail('WEB_ORIGIN в локальном .env должен указывать на localhost.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(webOrigin.hostname) || webOrigin.protocol !== 'http:') {
    fail('Этот скрипт разрешён только для локальной среды разработки.');
  }
  if (!env.get('KEYCLOAK_ADMIN_USERNAME') || !env.get('KEYCLOAK_ADMIN_PASSWORD')) {
    fail('В локальном .env отсутствуют bootstrap-реквизиты Keycloak.');
  }
  const login = await request('/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    form: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: env.get('KEYCLOAK_ADMIN_USERNAME'),
      password: env.get('KEYCLOAK_ADMIN_PASSWORD'),
    }),
    label: 'Вход администратора локального Keycloak',
  });
  token = login.access_token;
  // Dev-клиента нет в production realm: дополнительная проверка до любых изменений.
  const devClient = await findClient('sozhiteli-dev-cli');
  if (!devClient?.enabled || !devClient.directAccessGrantsEnabled) {
    fail('Realm не похож на локальный: отсутствует включённый sozhiteli-dev-cli. Изменения не внесены.');
  }
  let user = await findAdmin();
  if (user && user.attributes?.[ownerAttribute]?.[0] !== ownerValue) {
    fail('Имя локального администратора уже занято другой учётной записью. Права и пароль не изменены.');
  }
  let role = await api(`/roles/${adminRoleName}`, { allow404: true });
  if (!role) {
    await api('/roles', {
      method: 'POST',
      json: { name: adminRoleName, description: 'Встроенная админка: чтение. Назначается явно.' },
      label: 'Создание роли администратора',
    });
    role = await api(`/roles/${adminRoleName}`);
  }
  const realmConfig = await api('');
  const defaultRoles = await api(`/roles-by-id/${realmConfig.defaultRole.id}/composites/realm`);
  if (defaultRoles.some((defaultRole) => defaultRole.name === adminRoleName)) {
    fail('Роль sozhiteli-admin включена в роли по умолчанию. Уберите её оттуда перед настройкой.');
  }
  for (const clientId of ['sozhiteli-web', 'sozhiteli-mobile', 'sozhiteli-dev-cli']) {
    const client = await findClient(clientId);
    if (client) await ensureRoleMapper(client);
  }

  let reader = await findClient(readerClientId);
  if (reader?.publicClient || reader?.standardFlowEnabled || reader?.directAccessGrantsEnabled) {
    fail('Клиент profile-admin-reader уже существует с другой конфигурацией. Проверьте его вручную.');
  }
  const secretAlreadySet = Boolean(env.get('KEYCLOAK_ADMIN_CLIENT_SECRET'));
  const readerSecret = env.get('KEYCLOAK_ADMIN_CLIENT_SECRET') || randomBytes(32).toString('hex');
  if (!secretAlreadySet) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const entry = `KEYCLOAK_ADMIN_CLIENT_SECRET=${readerSecret}`;
    const updated = /^\s*KEYCLOAK_ADMIN_CLIENT_SECRET=.*$/m.test(source)
      ? source.replace(/^\s*KEYCLOAK_ADMIN_CLIENT_SECRET=.*$/m, entry)
      : `${source}${source.endsWith('\n') ? '' : eol}${entry}${eol}`;
    writePrivate(envPath, updated);
  }
  const readerConfig = {
    ...(reader || {}),
    clientId: readerClientId,
    name: 'Profile: чтение пользователей для встроенной админки',
    enabled: true,
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    secret: readerSecret,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
  };
  await api(`/clients${reader ? `/${reader.id}` : ''}`, {
    method: reader ? 'PUT' : 'POST',
    json: readerConfig,
    label: 'Настройка клиента чтения пользователей',
  });
  reader = await findClient(readerClientId);
  const serviceAccount = await api(`/clients/${reader.id}/service-account-user`);
  const management = await findClient('realm-management');
  const viewUsers = await api(`/clients/${management.id}/roles/view-users`);
  const currentGrants = await api(`/users/${serviceAccount.id}/role-mappings/clients/${management.id}`);
  const excessGrants = currentGrants.filter((grant) => grant.name !== 'view-users');
  if (excessGrants.length) {
    fail('У profile-admin-reader есть лишние роли realm-management. Уберите их вручную перед настройкой.');
  }
  await api(`/users/${serviceAccount.id}/role-mappings/clients/${management.id}`, {
    method: 'POST',
    json: [viewUsers],
    label: 'Выдача только view-users служебному клиенту',
  });

  const userCreated = !user;
  if (!user) {
    // Явно объявленный атрибут с доступом только admin не даёт обычному
    // пользователю пометить свой аккаунт как созданный этим инструментом.
    const profile = await api('/users/profile');
    const marker = profile.attributes.find((attribute) => attribute.name === ownerAttribute);
    if (!marker) {
      profile.attributes.push({
        name: ownerAttribute,
        displayName: 'Local admin provisioning owner',
        permissions: { view: ['admin'], edit: ['admin'] },
        multivalued: false,
      });
      await api('/users/profile', { method: 'PUT', json: profile, label: 'Настройка служебной метки' });
    } else if (marker.permissions?.edit?.includes('user')) {
      fail('Служебную метку администратора может менять пользователь. Исправьте разрешения вручную.');
    }
    mkdirSync(path.dirname(credentialsPath), { recursive: true });
    checkPrivatePath(credentialsPath);
    let password;
    if (existsSync(credentialsPath)) {
      const saved = readFileSync(credentialsPath, 'utf8');
      password = /^Пароль: (\S+)$/m.exec(saved)?.[1];
      if (!password || !saved.includes(`Логин: ${username}`)) {
        fail('Существующий research/local-admin.txt не соответствует ожидаемому формату; он не изменён.');
      }
    } else {
      password = randomBytes(24).toString('base64url');
      writePrivate(
        credentialsPath,
        [
          'Локальный администратор «Сожители». Только для разработки.',
          'Вход: http://localhost:3000/admin',
          `Логин: ${username}`,
          `Пароль: ${password}`,
          '',
          'Скрипт не меняет пароль при повторном запуске. Не публикуйте этот файл.',
          '',
        ].join('\n'),
        { exclusive: true },
      );
    }
    await api('/users', {
      method: 'POST',
      json: {
        username,
        email: username,
        emailVerified: true,
        enabled: true,
        attributes: { [ownerAttribute]: [ownerValue] },
        credentials: [{ type: 'password', value: password, temporary: false }],
      },
      label: 'Создание отдельного локального администратора',
    });
    user = await findAdmin();
    if (user?.attributes?.[ownerAttribute]?.[0] !== ownerValue) {
      fail('Не удалось подтвердить служебную метку нового аккаунта. Роль администратора не выдана.');
    }
  }
  await api(`/users/${user.id}/role-mappings/realm`, {
    method: 'POST',
    json: [role],
    label: 'Назначение роли отдельному локальному администратору',
  });
  token = undefined;
  console.log(`Локальный администратор: ${username} (${userCreated ? 'создан' : 'уже существует'}).`);
  console.log(
    existsSync(credentialsPath)
      ? 'Реквизиты: research/local-admin.txt (пароль не выводится и не сбрасывается).'
      : 'Файл реквизитов отсутствует. Пароль существующего аккаунта не сброшен; задайте его вручную в Keycloak.',
  );
  console.log(
    `Секрет серверного клиента: ${secretAlreadySet ? 'сохранён существующий' : 'создан в локальном .env'}.`,
  );
  console.log('Перезапустите Profile с новой конфигурацией; войдите заново для обновления роли в токене.');
}

main().catch((error) => {
  token = undefined;
  console.error(
    error instanceof SetupError ? error.message : 'Не удалось настроить локальную админку. Секреты скрыты.',
  );
  process.exitCode = 1;
});
