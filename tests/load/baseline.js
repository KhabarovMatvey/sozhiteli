// Базовый нагрузочный сценарий: постоянный поток запросов заданной
// интенсивности в течение 3 минут.
//
// Пороги ниже - это ПРЕДВАРИТЕЛЬНЫЕ SLO из docs/SCALING_PLAN.md, то есть
// инженерные допущения, а не измеренные возможности системы. Сценарий
// отвечает на вопрос "выдерживает ли один экземпляр сервиса целевую
// интенсивность с целевыми задержками на данной машине".
//
//   RATE - запросов в секунду (по умолчанию 50)
//
// После реализации продуктовых операций сюда добавляются их сценарии
// (docs/BACKLOG.md, задача Q-02): выдача кандидатов, карточка кандидата,
// создание запроса на контакт.

import { getQuestionnaire, getReadiness } from './lib.js';

const RATE = Number(__ENV.RATE || 50);

export const options = {
  scenarios: {
    read_without_database: {
      executor: 'constant-arrival-rate',
      exec: 'questionnaire',
      rate: RATE,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
    read_with_database: {
      executor: 'constant-arrival-rate',
      exec: 'readiness',
      rate: Math.max(1, Math.round(RATE / 5)),
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
  },
  thresholds: {
    // Доля ошибок: SLO доступности.
    http_req_failed: ['rate<0.005'],
    // Задержки чтения на стороне сервиса: SLO-L1.
    'http_req_duration{scenario:read_without_database}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{scenario:read_with_database}': ['p(95)<150', 'p(99)<400'],
    // Если k6 не успевает создавать запросы, результат недостоверен.
    dropped_iterations: ['count==0'],
  },
};

export function questionnaire() {
  getQuestionnaire();
}

export function readiness() {
  getReadiness();
}
