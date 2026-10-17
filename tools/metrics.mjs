#!/usr/bin/env node
// Метрики эксперимента MVP (задача E-01; определения - docs/MVP_SCOPE.md, шаг 5;
// механизм - docs/adr/0010).
//
//   npm run metrics                     сводка в консоль
//   npm run metrics -- --csv <каталог>  плюс данные по парам для анализа
//
// Каждый сервис хранит факты о своих действиях в своей базе; сведение - здесь,
// а не в сервисах. Выгружаются только обезличенные идентификаторы, счётчики и
// время: без имён, анкет и контактов. Запросы - docs/EXPERIMENT_QUERIES.md.
//
// Скрипт работает с локальной средой (deploy/compose). Для другой среды те же
// запросы выполняются оператором с доступом только на чтение.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { demoIdPattern, psql } from './lib.mjs';

// Возвращает строки результата как массивы полей (разделитель - табуляция).
function query(database, sql) {
  const out = psql(database, sql);
  return out
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));
}

const csvDir = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : null;

// --- факты из трёх баз ------------------------------------------------------

const [[registered]] = query(
  'keycloak_db',
  `SELECT count(*) FROM user_entity u JOIN realm r ON r.id = u.realm_id
   WHERE r.name = 'sozhiteli' AND u.service_account_client_link IS NULL`,
);
// Демо-анкеты (npm run demo:seed) - не люди, в метрики не входят.
const notDemo = (column) => `${column}::text NOT LIKE '${demoIdPattern}'`;

const [[profiles]] = query('profile_db', `SELECT count(*) FROM profile WHERE ${notDemo('user_id')}`);

// Все просмотры карточек по порядку. Какой из них учитывать, решается ниже:
// для M3 важно сравнение, которое человек видел перед решением.
const allViews = query(
  'matching_db',
  `SELECT viewer_id, candidate_id, matched_count, compared_count, viewed_at
   FROM candidate_view
   WHERE ${notDemo('viewer_id')} AND ${notDemo('candidate_id')}
   ORDER BY viewed_at`,
).map(([viewer, candidate, matched, compared, viewedAt]) => ({
  viewer,
  candidate,
  matched: Number(matched),
  compared: Number(compared),
  viewedAt,
  at: Date.parse(viewedAt.replace(' ', 'T').replace(/\+00$/, 'Z')),
}));

const requests = query(
  'interaction_db',
  `SELECT sender_id, recipient_id, status, created_at, responded_at FROM contact_request
   WHERE ${notDemo('sender_id')} AND ${notDemo('recipient_id')}`,
).map(([sender, recipient, status, createdAt, respondedAt]) => ({
  sender,
  recipient,
  status,
  createdAt,
  respondedAt,
}));
const [[contacts]] = query('interaction_db', `SELECT count(*) FROM contact WHERE ${notDemo('user_id')}`);

// --- метрики ----------------------------------------------------------------

const requestByPair = new Map(requests.map((r) => [`${r.sender}|${r.recipient}`, r]));
const parseTime = (t) => Date.parse(t.replace(' ', 'T').replace(/\+00$/, 'Z'));

// Одна строка на пару «зритель — кандидат». Если запрос отправлен, берётся
// последний просмотр ДО запроса: именно это сравнение было перед решением.
// Иначе - последний просмотр вообще.
const viewsByPair = new Map();
for (const v of allViews) {
  const key = `${v.viewer}|${v.candidate}`;
  viewsByPair.set(key, [...(viewsByPair.get(key) ?? []), v]);
}
const pairs = [...viewsByPair.entries()].map(([key, list]) => {
  const request = requestByPair.get(key);
  const before = request ? list.filter((v) => v.at <= parseTime(request.createdAt)) : list;
  const view = (before.length > 0 ? before : list).at(-1);
  return { ...view, request, viewedBeforeRequest: request ? before.length > 0 : undefined };
});
const withRequest = pairs.filter((p) => p.request);
const withoutRequest = pairs.filter((p) => !p.request);
const accepted = requests.filter((r) => r.status === 'accepted').length;
const declined = requests.filter((r) => r.status === 'declined').length;
const pending = requests.filter((r) => r.status === 'pending').length;

const share = (part, whole) =>
  whole === 0 ? 'нет данных' : `${((100 * part) / whole).toFixed(1)} % (${part} из ${whole})`;
const avgRatio = (list) => {
  const comparable = list.filter((p) => p.compared > 0);
  if (comparable.length === 0) return 'нет данных';
  const avg = comparable.reduce((sum, p) => sum + p.matched / p.compared, 0) / comparable.length;
  return `${(100 * avg).toFixed(1)} % совпадений в среднем (пар: ${comparable.length})`;
};

console.log('Метрики эксперимента (определения: docs/MVP_SCOPE.md, шаг 5)\n');
console.log('M1  Просмотр карточки → запрос на контакт:', share(withRequest.length, pairs.length));
console.log(
  'M2  Доля принятых среди отвеченных:       ',
  share(accepted, accepted + declined),
  `· ожидают ответа: ${pending}`,
);
console.log('M3  Доля совпадений привычек в паре');
console.log('      с запросом:                         ', avgRatio(withRequest));
console.log('      без запроса:                        ', avgRatio(withoutRequest));
console.log('M4  Зарегистрировались → заполнили анкету:', share(Number(profiles), Number(registered)));
console.log('\nСправочно: указали контакт —', contacts, '· всего запросов —', requests.length);
console.log('Пороги успеха не заданы (вопрос Q-2): интерпретация - за владельцем продукта.');
console.log(
  'M3 сравнивает средние и не доказывает причинную связь; при малом числе пар вывод делать нельзя.',
);

// Запросы, перед которыми карточку не открывали, сравнение не видели.
const unviewed = requests.filter((r) => !pairs.some((p) => p.request === r && p.viewedBeforeRequest));
if (unviewed.length > 0) {
  console.log(
    `\nЗапросов без просмотра карточки перед отправкой: ${unviewed.length}. В M3 для них взят последний просмотр после запроса - учитывайте при анализе.`,
  );
}

if (csvDir) {
  mkdirSync(csvDir, { recursive: true });
  const header =
    'viewer_id,candidate_id,last_viewed_at,matched_count,compared_count,request_status,request_created_at,responded_at';
  const lines = pairs.map((p) =>
    [
      p.viewer,
      p.candidate,
      p.viewedAt,
      p.matched,
      p.compared,
      p.request?.status ?? '',
      p.request?.createdAt ?? '',
      p.request?.respondedAt ?? '',
    ].join(','),
  );
  const file = path.join(csvDir, 'pairs.csv');
  writeFileSync(file, [header, ...lines].join('\n') + '\n', 'utf8');
  console.log(`\nДанные по парам: ${file}`);
}
