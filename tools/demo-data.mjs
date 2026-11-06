#!/usr/bin/env node
// Демо-анкеты, чтобы локально было кого смотреть. ТОЛЬКО для локальной среды.
//
//   npm run demo:seed    60 анкет в шести городах (Челябинск, Москва,
//                        Санкт-Петербург, Екатеринбург, Казань, Новосибирск);
//                        повторный запуск обновляет их и сдвигает даты заселения
//   npm run demo:clean   удаляет демо-анкеты и всё, что с ними связано
//
// Демо-анкеты - не люди: у них нет учётных записей и контактов, поэтому
// запрос контакта им останется без ответа. Контакты не создаются намеренно:
// придуманный ник в Telegram или VK может принадлежать реальному человеку.
// Идентификаторы начинаются с demoIdPrefix (tools/lib.mjs); по нему данные
// удаляются и исключаются из метрик (tools/metrics.mjs).

import { demoIdPattern, demoIdPrefix, psql as sql } from './lib.mjs';

// id - из migrations/00002_cities.sql профиля.
const cities = [
  {
    id: 1078,
    count: 14,
    budget: [8000, 16000],
    places: ['ЮУрГУ', 'ЧелГУ', 'ЮУГМУ', 'ЮУрГГПУ'],
    districts: ['центр', 'Северо-Запад', 'Ленинский район', 'Калининский район', 'рядом с ЮУрГУ'],
  },
  {
    id: 412,
    count: 12,
    budget: [20000, 35000],
    places: ['МГУ', 'ВШЭ', 'МГТУ им. Баумана', 'РУДН', 'МФТИ'],
    districts: ['ЮЗАО', 'рядом с метро', 'САО', 'Таганка', 'Измайлово'],
  },
  {
    id: 840,
    count: 10,
    budget: [15000, 28000],
    places: ['СПбГУ', 'ИТМО', 'Политех', 'ЛЭТИ'],
    districts: ['Петроградка', 'Василеостровский', 'Купчино', 'рядом с метро'],
  },
  {
    id: 886,
    count: 10,
    budget: [11000, 20000],
    places: ['УрФУ', 'УГМУ', 'УрГЭУ'],
    districts: ['центр', 'Втузгородок', 'ВИЗ', 'Академический'],
  },
  {
    id: 772,
    count: 7,
    budget: [10000, 18000],
    places: ['КФУ', 'КНИТУ-КАИ', 'КГМУ'],
    districts: ['Вахитовский район', 'Ново-Савиновский', 'рядом с КФУ'],
  },
  {
    id: 550,
    count: 7,
    budget: [10000, 18000],
    places: ['НГУ', 'НГТУ', 'СибГУТИ'],
    districts: ['Академгородок', 'центр', 'Октябрьский район'],
  },
];

const names = {
  female: [
    'Анна',
    'Мария',
    'Дарья',
    'Полина',
    'Екатерина',
    'Алина',
    'Виктория',
    'Софья',
    'Ксения',
    'Арина',
    'Вероника',
    'Юлия',
  ],
  male: [
    'Иван',
    'Артём',
    'Максим',
    'Дмитрий',
    'Никита',
    'Егор',
    'Кирилл',
    'Михаил',
    'Даниил',
    'Илья',
    'Тимур',
    'Глеб',
  ],
};

const jobs = [
  'работаю в IT',
  'работаю дизайнером',
  'работаю в банке',
  'работаю инженером',
  'работаю в маркетинге',
  'работаю бухгалтером',
  'работаю в рознице',
];

// Варианты ответов анкеты v2 (backend/services/profile/internal/questionnaire)
// с весами: распространённые ответы встречаются чаще.
const habits = {
  noise: [
    ['quiet', 3],
    ['moderate', 5],
    ['relaxed', 2],
  ],
  remote_work: [
    ['rarely', 4],
    ['sometimes', 4],
    ['mostly', 2],
  ],
  personal_space: [
    ['strict', 3],
    ['flexible', 6],
    ['open', 1],
  ],
  smoking: [
    ['no', 7],
    ['outside', 2],
    ['at_home', 1],
  ],
  pets: [
    ['none', 7],
    ['have', 3],
  ],
  dishes: [
    ['right_away', 4],
    ['same_day', 5],
    ['when_piles_up', 1],
  ],
  cleaning: [
    ['schedule', 6],
    ['as_needed', 4],
  ],
  guests: [
    ['none', 3],
    ['with_notice', 6],
    ['freely', 1],
  ],
  sleep: [
    ['before_23', 3],
    ['around_midnight', 5],
    ['after_1', 2],
  ],
  shared_purchases: [
    ['split', 6],
    ['separate', 4],
  ],
  socializing: [
    ['friends', 3],
    ['neutral', 5],
    ['minimal', 2],
  ],
};

// Детерминированный генератор: повторный запуск даёт те же анкеты.
function random(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const weighted = (rnd, options) => {
  let x = rnd() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of options) {
    x -= w;
    if (x < 0) return value;
  }
  return options[options.length - 1][0];
};
const round500 = (n) => Math.round(n / 500) * 500;
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;

function profiles() {
  const year = new Date().getFullYear();
  const rows = [];
  let n = 0;
  for (const city of cities) {
    for (let i = 0; i < city.count; i += 1) {
      n += 1;
      const rnd = random(n * 7919);
      const gender = rnd() < 0.55 ? 'female' : 'male';
      const student = rnd() < 0.7;
      const course = 1 + Math.floor(rnd() * 5);
      const occupation = student
        ? `${gender === 'female' ? 'студентка' : 'студент'} ${pick(rnd, city.places)}, ${course} курс`
        : pick(rnd, jobs);
      const age = student ? 17 + course + Math.floor(rnd() * 2) : 23 + Math.floor(rnd() * 8);
      const [low, high] = city.budget;
      const min = round500(low + rnd() * (high - low) * 0.6);
      const max = min + round500(2000 + rnd() * 5000);
      const from = Math.floor(rnd() * 35);
      const length = 20 + Math.floor(rnd() * 40);
      const districtCount = Math.floor(rnd() * 3);
      const districts = [...new Set(Array.from({ length: districtCount }, () => pick(rnd, city.districts)))];
      rows.push({
        userId: `${demoIdPrefix}0000-4000-8000-${String(n).padStart(12, '0')}`,
        name: pick(rnd, names[gender]),
        birthYear: year - Math.max(age, 18),
        gender,
        occupation,
        cityId: city.id,
        districts: districts.join(', '),
        min,
        max,
        from,
        to: from + length,
        roommate: rnd() < 0.3 ? 'same' : 'any',
        habits: Object.fromEntries(Object.entries(habits).map(([q, options]) => [q, weighted(rnd, options)])),
      });
    }
  }
  return rows;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const countInMatching = () =>
  Number(sql('matching_db', `SELECT count(*) FROM candidate WHERE user_id::text LIKE '${demoIdPattern}'`));

async function waitFor(expected, label) {
  const started = Date.now();
  for (;;) {
    const n = countInMatching();
    if (n === expected) {
      console.log(`${label} (${((Date.now() - started) / 1000).toFixed(1)} с)`);
      return;
    }
    if (Date.now() - started > 120_000) {
      console.error(`${label}: не дождались за 2 минуты (в Matching ${n}, ожидалось ${expected})`);
      process.exit(1);
    }
    await sleep(500);
  }
}

const command = process.argv[2];

if (command === 'seed') {
  const rows = profiles();
  const values = rows.map(
    (p) =>
      `(${quote(p.userId)}::uuid, ${quote(p.name)}, ${p.birthYear}, ${quote(p.gender)}, ${quote(p.occupation)},
        ${p.cityId}, ${quote(p.districts)}, ${p.min}, ${p.max},
        current_date + ${p.from}, current_date + ${p.to}, ${quote(p.roommate)}, 2,
        ${quote(JSON.stringify(p.habits))}::jsonb, 'searching')`,
  );
  sql(
    'profile_db',
    `INSERT INTO profile (user_id, display_name, birth_year, gender, occupation, city_id, districts,
                          budget_min_rub, budget_max_rub, move_in_from, move_in_to, roommate_gender,
                          questionnaire_version, habits, search_status)
     VALUES ${values.join(',\n')}
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name, birth_year = EXCLUDED.birth_year, gender = EXCLUDED.gender,
       occupation = EXCLUDED.occupation, city_id = EXCLUDED.city_id, districts = EXCLUDED.districts,
       budget_min_rub = EXCLUDED.budget_min_rub, budget_max_rub = EXCLUDED.budget_max_rub,
       move_in_from = EXCLUDED.move_in_from, move_in_to = EXCLUDED.move_in_to,
       roommate_gender = EXCLUDED.roommate_gender, questionnaire_version = EXCLUDED.questionnaire_version,
       habits = EXCLUDED.habits, search_status = EXCLUDED.search_status`,
  );
  console.log(`Записано демо-анкет: ${rows.length}`);
  await waitFor(rows.length, 'Демо-анкеты доставлены в Matching');
  console.log('Анкеты видны тем, чьи условия совпадают: тот же город, бюджет и сроки заселения.');
} else if (command === 'clean') {
  const demo = (column) => `${column}::text LIKE '${demoIdPattern}'`;
  sql('interaction_db', `DELETE FROM contact_request WHERE ${demo('sender_id')} OR ${demo('recipient_id')}`);
  sql('matching_db', `DELETE FROM candidate_view WHERE ${demo('viewer_id')} OR ${demo('candidate_id')}`);
  sql('profile_db', `DELETE FROM profile WHERE ${demo('user_id')}`);
  await waitFor(0, 'Удаление доставлено в Matching');
  // Отметки об удалении уже прочитаны Matching и больше не нужны.
  sql('profile_db', `DELETE FROM profile_deletion WHERE ${demo('user_id')}`);
  console.log('Демо-анкеты удалены.');
} else {
  console.error('Использование: node tools/demo-data.mjs seed|clean');
  process.exit(2);
}
