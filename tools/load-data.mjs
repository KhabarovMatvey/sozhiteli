#!/usr/bin/env node
// Данные для нагрузочной проверки продуктовых операций.
// ТОЛЬКО для локальной среды.
//
//   npm run load:seed    10 000 анкет в Челябинске через базу Profile; ждёт, пока
//                        лента изменений доставит их в Matching, и сообщает время
//   npm run load:clean   удаляет эти анкеты и их следы (просмотры) из всех баз
//
// Анкеты помечены occupation = 'load-test'; ничего другого скрипт не трогает.

import { psql as sql } from './lib.mjs';

const COUNT = Number(process.env.LOAD_PROFILES ?? 10000);
const CITY_ID = 1078; // Челябинск, migrations/00002_cities.sql
const MARK = 'load-test';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const countInMatching = () =>
  Number(sql('matching_db', `SELECT count(*) FROM candidate WHERE occupation = '${MARK}'`));

async function waitFor(expected, label) {
  const started = Date.now();
  for (;;) {
    const n = countInMatching();
    if (n === expected) {
      console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} с`);
      return;
    }
    if (Date.now() - started > 600_000) {
      console.error(`${label}: не дождались за 10 минут (в Matching ${n}, ожидалось ${expected})`);
      process.exit(1);
    }
    await sleep(500);
  }
}

const command = process.argv[2];

if (command === 'seed') {
  if (
    countInMatching() > 0 ||
    Number(sql('profile_db', `SELECT count(*) FROM profile WHERE occupation = '${MARK}'`)) > 0
  ) {
    console.error('Данные нагрузки уже есть. Сначала: npm run load:clean');
    process.exit(1);
  }
  // Разнообразные условия и ответы: часть анкет проходит фильтры любого
  // зрителя, часть - нет, как в настоящей выдаче. Каждая партия - своя
  // транзакция, как при обычной работе.
  const batch = 1000;
  for (let from = 1; from <= COUNT; from += batch) {
    const to = Math.min(from + batch - 1, COUNT);
    sql(
      'profile_db',
      `INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                            budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                            questionnaire_version, habits, search_status)
       SELECT gen_random_uuid(), 'Нагрузка ' || g, 1995 + g % 12,
              CASE WHEN g % 2 = 0 THEN 'female' ELSE 'male' END, '${MARK}', ${CITY_ID}, '',
              b, b + 2000 + (g % 5) * 1000,
              current_date + (g % 60), current_date + (g % 60) + 30,
              CASE WHEN g % 4 = 0 THEN 'same' ELSE 'any' END, 1,
              jsonb_build_object(
                'smoking', (ARRAY['no','outside','at_home'])[1 + g % 3],
                'pets', (ARRAY['none','have'])[1 + g % 2],
                'dishes', (ARRAY['right_away','same_day','when_piles_up'])[1 + (g / 3) % 3],
                'cleaning', (ARRAY['schedule','as_needed'])[1 + (g / 2) % 2],
                'guests', (ARRAY['none','with_notice','freely'])[1 + (g / 5) % 3],
                'sleep', (ARRAY['before_23','around_midnight','after_1'])[1 + (g / 7) % 3],
                'shared_purchases', (ARRAY['split','separate'])[1 + (g / 11) % 2],
                'socializing', (ARRAY['friends','neutral','minimal'])[1 + (g / 13) % 3]),
              CASE WHEN g % 10 = 0 THEN 'paused' ELSE 'searching' END
       FROM generate_series(${from}, ${to}) g, LATERAL (SELECT 8000 + (g % 9) * 1000 AS b) x`,
    );
  }
  console.log(`Записано анкет в Profile: ${COUNT}`);
  await waitFor(COUNT, 'Доставлены в Matching через ленту изменений за');
} else if (command === 'clean') {
  sql(
    'matching_db',
    `DELETE FROM candidate_view v USING candidate c WHERE c.user_id = v.candidate_id AND c.occupation = '${MARK}'`,
  );
  sql('profile_db', `DELETE FROM profile WHERE occupation = '${MARK}'`);
  await waitFor(0, 'Удаление доставлено в Matching за');
  // Отметки об удалении уже прочитаны Matching и больше не нужны.
  sql(
    'profile_db',
    `DELETE FROM profile_deletion d WHERE NOT EXISTS (SELECT 1 FROM profile p WHERE p.user_id = d.user_id)
       AND d.deleted_at > now() - interval '1 hour'`,
  );
  console.log('Данные нагрузки удалены.');
} else {
  console.error('Использование: node tools/load-data.mjs seed|clean');
  process.exit(2);
}
