// Нагрузочный сценарий продуктовых операций Matching:
// выдача кандидатов, карточка со сравнением (с записью просмотра) и карточки
// по списку. Данные: npm run load:seed (10 000 анкет в одном городе).
//
//   npm run load:product                 3 минуты, RATE=50 запросов в секунду
//   RATE=150 npm run load:product
//
// Зритель - тестовый пользователь с анкетой в том же городе. Пороги - целевые
// показатели из README.md, раздел 9: для чтения и для карточки, которая пишет просмотр.

import http from 'k6/http';
import { check, fail } from 'k6';

const TARGET = __ENV.TARGET || 'http://matching:8080';
const RATE = Number(__ENV.RATE || 50);
const params = { headers: { Authorization: `Bearer ${__ENV.TOKEN}`, 'Content-Type': 'application/json' } };

export const options = {
  scenarios: {
    feed: {
      executor: 'constant-arrival-rate',
      exec: 'feed',
      rate: Math.round(RATE * 0.6),
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
    card: {
      executor: 'constant-arrival-rate',
      exec: 'card',
      rate: Math.round(RATE * 0.3),
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 30,
      maxVUs: 300,
    },
    lookup: {
      executor: 'constant-arrival-rate',
      exec: 'lookup',
      rate: Math.max(1, Math.round(RATE * 0.1)),
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_duration{scenario:feed}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{scenario:lookup}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{scenario:card}': ['p(95)<250', 'p(99)<600'],
    dropped_iterations: ['count==0'],
  },
};

// Собирает идентификаторы кандидатов и курсоры страниц выдачи один раз до нагрузки.
export function setup() {
  const ids = [];
  const cursors = [null];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const url = `${TARGET}/v1/candidates?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
    const res = http.get(url, params);
    if (res.status !== 200)
      fail(`feed returned ${res.status}: is the viewer profile and load data in place?`);
    const body = res.json();
    body.items.forEach((c) => ids.push(c.user_id));
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
    cursors.push(cursor);
  }
  if (ids.length < 100) fail(`only ${ids.length} candidates found; run npm run load:seed first`);
  return { ids, cursors };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Пользователь листает выдачу: первая страница или одна из следующих.
export function feed(data) {
  const cursor = pick(data.cursors);
  const res = http.get(`${TARGET}/v1/candidates${cursor ? `?cursor=${cursor}` : ''}`, params);
  check(res, { 'feed 200': (r) => r.status === 200 });
}

export function card(data) {
  const res = http.get(`${TARGET}/v1/candidates/${pick(data.ids)}`, params);
  check(res, { 'card 200': (r) => r.status === 200 });
}

export function lookup(data) {
  const ids = Array.from({ length: 20 }, () => pick(data.ids));
  const res = http.post(
    `${TARGET}/v1/candidates/lookup`,
    JSON.stringify({ user_ids: [...new Set(ids)] }),
    params,
  );
  check(res, { 'lookup 200': (r) => r.status === 200 });
}
