// Общие части сценариев k6. Запуск: npm run load:smoke | npm run load:baseline
//
// Переменные окружения задаёт tools/load.mjs:
//   TARGET - адрес сервиса внутри сети Compose (по умолчанию http://profile:8080);
//   TOKEN  - access token тестового пользователя (живёт 5 минут, поэтому
//            сценарии короче этого срока).

import http from 'k6/http';
import { check } from 'k6';

export const TARGET = __ENV.TARGET || 'http://profile:8080';
const TOKEN = __ENV.TOKEN;

export function authHeaders() {
  return { headers: { Authorization: `Bearer ${TOKEN}` } };
}

// Эталонная операция: проходит весь путь запроса (аутентификация по JWT,
// валидация по контракту, обработчик, сериализация) без обращения к БД.
// Это измерение накладных расходов платформы, а не продуктовых функций.
export function getQuestionnaire() {
  const response = http.get(`${TARGET}/v1/questionnaire`, authHeaders());
  check(response, { 'questionnaire 200': (r) => r.status === 200 });
  return response;
}

// Готовность: единственный путь фундамента, который ходит в PostgreSQL.
export function getReadiness() {
  const response = http.get(`${TARGET}/readyz`);
  check(response, { 'readyz 200': (r) => r.status === 200 });
  return response;
}
