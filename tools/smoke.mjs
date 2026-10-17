#!/usr/bin/env node
// Сквозная ИНФРАСТРУКТУРНАЯ проверка запущенной локальной среды.
//
//   npm run infra:up && npm run infra:smoke
//
// Скрипт не проверяет продуктовые функции. Он доказывает, что компоненты
// фундамента соединены правильно: маршрутизация, аутентификация, валидация по
// контракту, изоляция баз данных, межсервисная синхронизация Profile -> Matching.
// Тестовые строки, которые он добавляет, он же и удаляет.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeDir = path.join(root, 'deploy', 'compose');
const composeFile = path.join(composeDir, 'compose.yaml');

const EDGE = 'http://localhost:8080';
const KEYCLOAK = 'http://localhost:8081';
const TEST_USER_ID = '0b9d4d53-58a8-4c8f-9b0a-5d0f6a3f7c21';
const TEST_CITY_ID = 32000;

const env = Object.fromEntries(
  readFileSync(path.join(composeDir, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function compose(args, options = {}) {
  return execFileSync('docker', ['compose', '-f', composeFile, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

// Выполняет SQL в базе сервиса под указанной ролью. Возвращает { ok, out }.
function psql(role, password, database, sql) {
  try {
    const out = compose([
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${password}`,
      'postgres',
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      role,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      sql,
    ]);
    return { ok: true, out: out.trim() };
  } catch (error) {
    return { ok: false, out: String(error.stderr ?? error.message).trim() };
  }
}

async function request(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // тело не JSON
  }
  return { status: response.status, headers: response.headers, json, text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function userToken() {
  const realm = JSON.parse(readFileSync(path.join(composeDir, 'keycloak', 'realm-dev.json'), 'utf8'));
  const user = realm.users.find((u) => u.credentials);
  const response = await request(`${KEYCLOAK}/realms/sozhiteli/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'sozhiteli-dev-cli',
      username: user.username,
      password: user.credentials[0].value,
      scope: 'openid',
    }),
  });
  return response.json?.access_token ?? null;
}

async function main() {
  console.log('== Маршрутизация и готовность');
  const edge = await request(`${EDGE}/healthz`);
  check('edge отвечает на /healthz', edge.status === 200);
  for (const service of ['profile', 'matching', 'interaction']) {
    const ready = await request(`${EDGE}/api/${service}/readyz`);
    check(
      `${service}: /readyz сообщает о готовности БД`,
      ready.status === 200 && ready.json?.checks?.postgres === 'ok',
    );
  }

  console.log('== Аутентификация и единый формат ошибок');
  const anonymous = await request(`${EDGE}/api/profile/v1/questionnaire`);
  check(
    'запрос без токена -> 401 в формате problem+json',
    anonymous.status === 401 &&
      anonymous.headers.get('content-type') === 'application/problem+json' &&
      anonymous.json?.code === 'unauthorized',
  );
  check(
    'ответ содержит X-Request-Id, совпадающий с request_id в теле',
    Boolean(anonymous.headers.get('x-request-id')) &&
      anonymous.headers.get('x-request-id') === anonymous.json?.request_id,
  );

  const token = await userToken();
  check('Keycloak выдаёт access token тестовому пользователю', Boolean(token));
  const auth = { Authorization: `Bearer ${token}` };

  const questionnaire = await request(`${EDGE}/api/profile/v1/questionnaire`, { headers: auth });
  check(
    'эталонная операция getQuestionnaire -> 200',
    questionnaire.status === 200 && questionnaire.json?.questions?.length > 0,
    `вопросов: ${questionnaire.json?.questions?.length}`,
  );

  const ownProfile = await request(`${EDGE}/api/profile/v1/me/profile`, { headers: auth });
  check(
    'profile: чтение своей анкеты отвечает по контракту (200 или 404 profile_not_found)',
    ownProfile.status === 200 || (ownProfile.status === 404 && ownProfile.json?.code === 'profile_not_found'),
    `статус ${ownProfile.status}`,
  );
  const cities = await request(`${EDGE}/api/profile/v1/cities`, { headers: auth });
  check(
    'profile: справочник городов отвечает 200',
    cities.status === 200 && Array.isArray(cities.json?.items),
  );

  const feed = await request(`${EDGE}/api/matching/v1/candidates`, { headers: auth });
  check(
    'matching: выдача отвечает по контракту (200 или 409 profile_not_ready)',
    feed.status === 200 || (feed.status === 409 && feed.json?.code === 'profile_not_ready'),
    `статус ${feed.status}`,
  );

  const contact = await request(`${EDGE}/api/interaction/v1/me/contact`, { headers: auth });
  check(
    'interaction: чтение своего контакта отвечает по контракту (200 или 404 contact_not_found)',
    contact.status === 200 || (contact.status === 404 && contact.json?.code === 'contact_not_found'),
    `статус ${contact.status}`,
  );

  const invalid = await request(`${EDGE}/api/matching/v1/candidates?limit=9999`, { headers: auth });
  check(
    'запрос, нарушающий контракт -> 400 invalid_request',
    invalid.status === 400 && invalid.json?.code === 'invalid_request',
  );

  const tampered = await request(`${EDGE}/api/profile/v1/questionnaire`, {
    headers: { Authorization: `Bearer ${token.slice(0, -4)}AAAA` },
  });
  check('токен с испорченной подписью -> 401', tampered.status === 401);

  console.log('== Границы доступа');
  const internalViaEdge = await request(`${EDGE}/api/profile/internal/v1/profile-changes`, { headers: auth });
  check(
    'внутренний API Profile недоступен через edge',
    internalViaEdge.status === 404,
    `статус ${internalViaEdge.status}`,
  );

  const preflight = await request(`${EDGE}/api/profile/v1/questionnaire`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' },
  });
  check(
    'CORS: preflight от web-приложения разрешён',
    preflight.status === 204 &&
      preflight.headers.get('access-control-allow-origin') === 'http://localhost:3000',
  );
  const foreign = await request(`${EDGE}/api/profile/v1/questionnaire`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  check('CORS: чужой Origin не получает разрешения', !foreign.headers.get('access-control-allow-origin'));

  let published = '';
  try {
    published = compose(['port', 'postgres', '5432']).trim();
  } catch {
    published = '';
  }
  // Для неопубликованного порта Compose печатает ":0" или ничего.
  check('порт PostgreSQL не опубликован на хосте', published === '' || published === ':0', published);

  const edgeCanReach = (host, port) => {
    try {
      compose(['exec', '-T', 'edge', 'nc', '-z', '-w', '2', host, port]);
      return true;
    } catch {
      return false;
    }
  };
  // Положительный контроль: без него проверка ниже прошла бы и при отсутствии nc.
  check('edge-прокси достигает сервиса profile', edgeCanReach('profile', '8080'));
  check('edge-прокси не имеет сетевого доступа к PostgreSQL', !edgeCanReach('postgres', '5432'));

  console.log('== Изоляция данных между сервисами');
  const foreignDb = psql('profile_app', env.PROFILE_APP_PASSWORD, 'matching_db', 'SELECT 1');
  check('роль profile_app не может подключиться к matching_db', !foreignDb.ok);
  const foreignDb2 = psql('matching_app', env.MATCHING_APP_PASSWORD, 'interaction_db', 'SELECT 1');
  check('роль matching_app не может подключиться к interaction_db', !foreignDb2.ok);
  const ddl = psql(
    'profile_app',
    env.PROFILE_APP_PASSWORD,
    'profile_db',
    'CREATE TABLE smoke_forbidden (id int)',
  );
  check('рабочая роль сервиса не может менять схему', !ddl.ok);
  const own = psql('profile_app', env.PROFILE_APP_PASSWORD, 'profile_db', 'SELECT count(*) FROM profile');
  check('рабочая роль читает собственные таблицы', own.ok, `анкет: ${own.out}`);

  console.log('== Синхронизация Profile -> Matching (лента изменений, сервисный токен)');
  const superuser = (database, sql) => psql('postgres', env.POSTGRES_SUPERUSER_PASSWORD, database, sql);
  const candidateCount = () =>
    psql(
      'matching_app',
      env.MATCHING_APP_PASSWORD,
      'matching_db',
      `SELECT count(*) FROM candidate WHERE user_id = '${TEST_USER_ID}'`,
    ).out;
  const waitForCount = async (expected) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (candidateCount() === expected) return true;
      await sleep(500);
    }
    return false;
  };

  try {
    const seeded = superuser(
      'profile_db',
      `
      INSERT INTO city (id, name, region) VALUES (${TEST_CITY_ID}, 'smoke-test-city', 'smoke-test-region') ON CONFLICT DO NOTHING;
      INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                           budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                           questionnaire_version, habits, search_status)
      VALUES ('${TEST_USER_ID}', 'smoke-test', 2000, 'male', 'infrastructure check', ${TEST_CITY_ID}, '',
              10000, 15000, '2030-01-01', '2030-02-01', 'any', 1, '{"smoking":"no"}', 'searching')
      ON CONFLICT (user_id) DO NOTHING;`,
    );
    check('тестовая анкета записана в базу Profile', seeded.ok, seeded.ok ? '' : seeded.out);
    check('анкета появилась в проекции Matching', await waitForCount('1'));
  } finally {
    const removed = superuser(
      'profile_db',
      `
      DELETE FROM profile WHERE user_id = '${TEST_USER_ID}';
      DELETE FROM city WHERE id = ${TEST_CITY_ID};`,
    );
    check('тестовая анкета удалена из базы Profile', removed.ok, removed.ok ? '' : removed.out);
    check('удаление дошло до проекции Matching', await waitForCount('0'));
    superuser('profile_db', `DELETE FROM profile_deletion WHERE user_id = '${TEST_USER_ID}';`);
  }

  console.log(failed === 0 ? '\nВсе проверки пройдены.' : `\nНе пройдено проверок: ${failed}.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Проверка прервана:', error.message);
  process.exit(1);
});
