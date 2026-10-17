#!/usr/bin/env node
// Запуск нагрузочных сценариев k6 против локальной среды.
//
//   npm run infra:up
//   npm run load:smoke                 короткая проверка работоспособности
//   npm run load:baseline              3 минуты постоянной нагрузки
//   RATE=200 npm run load:baseline     другая интенсивность
//   TARGET=http://matching:8080 ...    другой сервис
//
// k6 запускается в контейнере внутри сети Compose и обращается к сервису
// напрямую, минуя edge-прокси: так измеряется сам сервис, а ограничение
// частоты запросов на прокси не искажает результат.
//
// Результаты зависят от машины. Сравнивать можно только прогоны на одном и
// том же стенде; фиксировать - в docs/SCALING_PLAN.md вместе с описанием стенда.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { images, root, run } from './lib.mjs';

const scenario = process.argv[2];
if (!['smoke', 'baseline', 'product'].includes(scenario)) {
  console.error('Использование: node tools/load.mjs smoke|baseline|product');
  process.exit(2);
}

const realm = JSON.parse(readFileSync(path.join(root, 'deploy/compose/keycloak/realm-dev.json'), 'utf8'));
// Сценарий product смотрит выдачу глазами пользователя с анкетой в Челябинске.
const user = realm.users.find((candidate) => candidate.credentials);

const response = await fetch('http://localhost:8081/realms/sozhiteli/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'sozhiteli-dev-cli',
    username: user.username,
    password: user.credentials[0].value,
    scope: 'openid',
  }),
}).catch(() => null);

const token = response?.ok ? (await response.json()).access_token : null;
if (!token) {
  console.error('Не удалось получить токен тестового пользователя. Запущена ли среда (npm run infra:up)?');
  process.exit(1);
}

run('docker', [
  'run',
  '--rm',
  '--network',
  'sozhiteli_backend',
  '-v',
  `${path.join(root, 'tests/load')}:/scripts:ro`,
  '-e',
  `TOKEN=${token}`,
  '-e',
  `TARGET=${process.env.TARGET ?? (scenario === 'product' ? 'http://matching:8080' : 'http://profile:8080')}`,
  '-e',
  `RATE=${process.env.RATE ?? '50'}`,
  images.k6,
  'run',
  `/scripts/${scenario}.js`,
]);
