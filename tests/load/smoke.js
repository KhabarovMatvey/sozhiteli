// Дымовой нагрузочный сценарий: 15 секунд, 2 виртуальных пользователя.
// Проверяет, что сам инструмент и окружение работают; о производительности
// ничего не говорит.

import { sleep } from 'k6';
import { getQuestionnaire, getReadiness } from './lib.js';

export const options = {
  vus: 2,
  duration: '15s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  getQuestionnaire();
  getReadiness();
  sleep(0.2);
}
