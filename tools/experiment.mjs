#!/usr/bin/env node
// Исследовательские данные отделены от продуктовых событий и баз сервисов.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECISION_HEADERS,
  FOLLOWUP_HEADERS,
  computeResults,
  parseCsv,
  stringifyCsv,
} from './experiment-results.mjs';

export const COHORT_HEADERS = ['participant_id', 'questionnaire_received_at'];
const ID = /^[A-Z][A-Z0-9_-]{2,31}$/;
const DAY = 24 * 60 * 60 * 1000;
const TOPICS = {
  sleep: 'Режим сна',
  noise: 'Шум и часы тишины',
  cleaning: 'Уборка',
  guests: 'Гости',
  smoking: 'Курение',
  socializing: 'Общение',
  personal_space: 'Личное пространство',
  dishes: 'Посуда',
  pets: 'Животные',
  shared_purchases: 'Бытовые покупки',
};
const REQUIRED_TOPICS = Object.keys(TOPICS).slice(0, 7);

function requireValue(condition, field) {
  if (!condition) throw new Error(`Проверьте поле ${field}.`);
}

function keys(value, required, optional, field) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), field);
  requireValue(
    required.every((key) => Object.hasOwn(value, key)),
    field,
  );
  requireValue(
    Object.keys(value).every((key) => [...required, ...optional].includes(key)),
    field,
  );
}

function identifier(value, field) {
  requireValue(typeof value === 'string' && ID.test(value), field);
}

function timestamp(value, field) {
  requireValue(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    field,
  );
  calendarDate(value.slice(0, 10), field);
  const time = Date.parse(value);
  requireValue(Number.isFinite(time), field);
  requireValue(Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60, field);
  requireValue(Number(value.slice(17, 19)) < 60, field);
  return time;
}

function calendarDate(value, field) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), field);
  const date = new Date(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, field);
  return date.getTime();
}

function textValue(value, field) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 2000, field);
  // Это только барьер от случайного копирования контактов. Ручное обезличивание обязательно.
  requireValue(!/@|https?:|www\.|t\.me|vk\.com|\d{7}|\+\d[\d ()-]{8,}/i.test(value), field);
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), field);
}

function validateProfile(profile, field) {
  keys(
    profile,
    [
      'questionnaire_version',
      'city',
      'districts',
      'budget_min_rub',
      'budget_max_rub',
      'move_in_from',
      'move_in_to',
      'household',
    ],
    [],
    field,
  );
  requireValue(profile.questionnaire_version === 1, `${field}.questionnaire_version`);
  for (const key of ['city', 'districts']) textValue(profile[key], `${field}.${key}`);
  for (const key of ['budget_min_rub', 'budget_max_rub']) {
    requireValue(Number.isSafeInteger(profile[key]) && profile[key] >= 0, `${field}.${key}`);
  }
  requireValue(profile.budget_min_rub <= profile.budget_max_rub, `${field}.budget`);
  requireValue(
    calendarDate(profile.move_in_from, `${field}.move_in_from`) <=
      calendarDate(profile.move_in_to, `${field}.move_in_to`),
    `${field}.move_in`,
  );
  keys(profile.household, REQUIRED_TOPICS, Object.keys(TOPICS).slice(7), `${field}.household`);
  for (const [topic, answer] of Object.entries(profile.household)) {
    textValue(answer, `${field}.household.${topic}`);
  }
}

export function validateSelection(selection, cohort, { now = new Date() } = {}) {
  keys(
    selection,
    ['schema_version', 'participant_id', 'prepared_at', 'participant_profile', 'candidates'],
    [],
    'selection',
  );
  requireValue(selection.schema_version === 1, 'schema_version');
  identifier(selection.participant_id, 'participant_id');
  const participant = cohort.participants.find((item) => item.participant_id === selection.participant_id);
  requireValue(participant, 'participant_id: нет в когорте');
  const prepared = timestamp(selection.prepared_at, 'prepared_at');
  requireValue(prepared <= new Date(now).getTime(), 'prepared_at: будущая дата');
  requireValue(
    prepared >= timestamp(participant.questionnaire_received_at, 'questionnaire_received_at'),
    'prepared_at',
  );
  validateProfile(selection.participant_profile, 'participant_profile');
  requireValue(
    Array.isArray(selection.candidates) && [2, 3].includes(selection.candidates.length),
    'candidates: нужны 2–3',
  );
  const ids = new Set([selection.participant_id]);
  for (const [index, candidate] of selection.candidates.entries()) {
    const field = `candidates[${index + 1}]`;
    keys(
      candidate,
      [
        'candidate_id',
        'active_confirmed_at',
        'share_consent',
        'district_confirmed',
        'conditions_confirmed',
        'profile',
      ],
      [],
      field,
    );
    identifier(candidate.candidate_id, `${field}.candidate_id`);
    requireValue(!ids.has(candidate.candidate_id), `${field}.candidate_id: повтор`);
    ids.add(candidate.candidate_id);
    const checked = timestamp(candidate.active_confirmed_at, `${field}.active_confirmed_at`);
    requireValue(
      checked <= prepared && prepared - checked <= DAY,
      `${field}.active_confirmed_at: подтвердите актуальность за последние 24 часа`,
    );
    for (const confirmation of ['share_consent', 'district_confirmed', 'conditions_confirmed']) {
      requireValue(candidate[confirmation] === true, `${field}.${confirmation}`);
    }
    validateProfile(candidate.profile, `${field}.profile`);
    const mine = selection.participant_profile;
    const theirs = candidate.profile;
    requireValue(mine.city === theirs.city, `${field}.profile.city`);
    requireValue(
      mine.budget_min_rub <= theirs.budget_max_rub && theirs.budget_min_rub <= mine.budget_max_rub,
      `${field}.profile.budget: нет пересечения`,
    );
    requireValue(
      mine.move_in_from <= theirs.move_in_to && theirs.move_in_from <= mine.move_in_to,
      `${field}.profile.move_in: нет пересечения`,
    );
  }
  return selection;
}

function readJson(filename) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Не удалось прочитать JSON. Проверьте наличие файла и его синтаксис.');
  }
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function writePrivate(filename, content) {
  writeFileSync(filename, content, { flag: 'wx', mode: 0o600 });
}

function writeFrozen(filename, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writePrivate(filename, content);
  writePrivate(`${filename}.sha256`, `${checksum(content)}\n`);
}

function readFrozen(filename) {
  let content, expected;
  try {
    content = readFileSync(filename, 'utf8');
    expected = readFileSync(`${filename}.sha256`, 'utf8').trim();
  } catch {
    throw new Error('Нет полного зафиксированного снимка и его SHA-256.');
  }
  requireValue(expected === checksum(content), 'SHA-256: зафиксированные данные изменены');
  return readJson(filename);
}

function validateCohort(cohort, now) {
  keys(cohort, ['schema_version', 'frozen_at', 'participants'], [], 'cohort');
  requireValue(cohort.schema_version === 1, 'cohort.schema_version');
  const frozen = timestamp(cohort.frozen_at, 'cohort.frozen_at');
  requireValue(frozen <= new Date(now).getTime(), 'cohort.frozen_at: будущая дата');
  requireValue(Array.isArray(cohort.participants) && cohort.participants.length > 0, 'cohort.participants');
  const ids = new Set();
  for (const participant of cohort.participants) {
    keys(participant, COHORT_HEADERS, [], 'cohort.participants');
    identifier(participant.participant_id, 'cohort.participant_id');
    requireValue(!ids.has(participant.participant_id), 'cohort.participant_id: повтор');
    ids.add(participant.participant_id);
    requireValue(
      timestamp(participant.questionnaire_received_at, 'questionnaire_received_at') <= frozen,
      'questionnaire_received_at: позже фиксации когорты',
    );
  }
}

export function initExperiment(cohortFile, directory, { now = new Date() } = {}) {
  const participants = parseCsv(readFileSync(cohortFile, 'utf8'), {
    headers: COHORT_HEADERS,
    label: 'cohort',
  });
  const cohort = { schema_version: 1, frozen_at: new Date(now).toISOString(), participants };
  validateCohort(cohort, now);
  // Новая папка — граница запуска: повторный init не перезапишет когорту и ответы.
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(path.join(directory, 'offers'), { mode: 0o700 });
  mkdirSync(path.join(directory, 'cards'), { mode: 0o700 });
  writeFrozen(path.join(directory, 'cohort.json'), cohort);
  writePrivate(
    path.join(directory, 'decisions.csv'),
    stringifyCsv(
      DECISION_HEADERS,
      participants.map(({ participant_id }) => ({ participant_id, status: 'pending' })),
    ),
  );
  writePrivate(path.join(directory, 'followups.csv'), stringifyCsv(FOLLOWUP_HEADERS, []));
  return cohort;
}

function markdown(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}|#!])/g, '\\$1')
    .replace(/\r?\n/g, '<br>');
}

export function renderCards(selection) {
  const mine = selection.participant_profile;
  const lines = [
    `# Кандидаты для ${markdown(selection.participant_id)}`,
    '',
    `Набор подготовлен: ${markdown(selection.prepared_at)}. Порядок кандидатов зафиксирован.`,
    '',
    'Изучите все карточки. Можно выбрать кандидата или ответить «Никто не подошёл». Затем объясните решение своими словами. Контактами можно обменяться в приложении по взаимному согласию.',
    '',
  ];
  for (const [index, candidate] of selection.candidates.entries()) {
    const theirs = candidate.profile;
    lines.push(
      `## ${index + 1}. ${markdown(candidate.candidate_id)}`,
      '',
      '| Условия | Вы | Кандидат |',
      '|---|---|---|',
    );
    for (const [label, a, b] of [
      ['Город', mine.city, theirs.city],
      ['Районы', mine.districts, theirs.districts],
      [
        'Бюджет, рублей в месяц',
        `${mine.budget_min_rub}–${mine.budget_max_rub}`,
        `${theirs.budget_min_rub}–${theirs.budget_max_rub}`,
      ],
      [
        'Сроки заселения',
        `${mine.move_in_from} — ${mine.move_in_to}`,
        `${theirs.move_in_from} — ${theirs.move_in_to}`,
      ],
    ])
      lines.push(`| ${label} | ${markdown(a)} | ${markdown(b)} |`);
    lines.push('', '| Бытовые привычки и ожидания | Вы | Кандидат |', '|---|---|---|');
    for (const [topic, label] of Object.entries(TOPICS)) {
      if (Object.hasOwn(mine.household, topic) || Object.hasOwn(theirs.household, topic)) {
        lines.push(
          `| ${label} | ${markdown(mine.household[topic] ?? 'Не уточнено')} | ${markdown(theirs.household[topic] ?? 'Не уточнено')} |`,
        );
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function freezeOffer(selectionFile, directory, { now = new Date() } = {}) {
  const cohort = readFrozen(path.join(directory, 'cohort.json'));
  validateCohort(cohort, now);
  const selection = validateSelection(readJson(selectionFile), cohort, { now });
  for (const candidate of selection.candidates) {
    requireValue(
      new Date(now).getTime() - timestamp(candidate.active_confirmed_at, 'active_confirmed_at') <= DAY,
      'active_confirmed_at: подтвердите актуальность перед фиксацией',
    );
  }
  const filename = path.join(directory, 'offers', `${selection.participant_id}.json`);
  const cardsFile = path.join(directory, 'cards', `${selection.participant_id}.md`);
  requireValue(
    !existsSync(filename) && !existsSync(`${filename}.sha256`) && !existsSync(cardsFile),
    'offer: набор уже существует; перезапись запрещена',
  );
  const snapshot = { ...selection, frozen_at: new Date(now).toISOString() };
  writeFrozen(filename, snapshot);
  writePrivate(cardsFile, renderCards(selection));
  return snapshot;
}

export function readExperiment(directory) {
  const cohort = readFrozen(path.join(directory, 'cohort.json'));
  validateCohort(cohort, new Date());
  const offers = readdirSync(path.join(directory, 'offers'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const snapshot = readFrozen(path.join(directory, 'offers', name));
      const { frozen_at, ...selection } = snapshot;
      const frozen = timestamp(frozen_at, 'offer.frozen_at');
      requireValue(frozen >= timestamp(cohort.frozen_at, 'cohort.frozen_at'), 'offer.frozen_at: до когорты');
      requireValue(frozen <= Date.now(), 'offer.frozen_at: будущая дата');
      validateSelection(selection, cohort, { now: frozen_at });
      for (const candidate of selection.candidates) {
        requireValue(
          frozen - timestamp(candidate.active_confirmed_at, 'active_confirmed_at') <= DAY,
          'active_confirmed_at: устарело до фиксации',
        );
      }
      requireValue(name === `${selection.participant_id}.json`, 'offer: имя снимка');
      const cards = readFileSync(path.join(directory, 'cards', `${selection.participant_id}.md`), 'utf8');
      requireValue(cards === renderCards(selection), 'cards: показанные карточки изменены');
      return snapshot;
    });
  return {
    cohort,
    offers,
    decisions: parseCsv(readFileSync(path.join(directory, 'decisions.csv'), 'utf8'), {
      headers: DECISION_HEADERS,
      label: 'decisions',
    }),
    followups: parseCsv(readFileSync(path.join(directory, 'followups.csv'), 'utf8'), {
      headers: FOLLOWUP_HEADERS,
      label: 'followups',
    }),
  };
}

export function reportExperiment(directory, options = {}) {
  const { cohort, offers, decisions, followups } = readExperiment(directory);
  return computeResults(cohort, offers, decisions, followups, options);
}

function showReport(report) {
  console.log(`Участников: ${report.participants}. Решений с ответом: ${report.completed_decisions}.`);
  console.log(
    `Повторных опросов с ответом: ${report.followup_respondents}. Оба опроса: ${report.completed_both}.`,
  );
  for (const [label, metric] of [
    ['MVP-1', report.mvp1],
    ['MVP-2', report.mvp2],
  ]) {
    console.log(
      `${label}: ${metric.numerator}/${metric.denominator} = ${metric.percent === null ? 'нет данных' : `${metric.percent.toFixed(2)}%`}; порог ${metric.threshold_percent}% ${metric.threshold_met ? 'достигнут' : 'не достигнут'}; неизвестно ${metric.unknown}.`,
    );
  }
  console.log(
    `Периоды наблюдения завершены: ${report.observation_windows_mature ? 'да' : 'нет'}. Результат: ${report.result}.`,
  );
  console.log(
    'Это описание ответов данной когорты, без вывода о статистической значимости. Неизвестные остаются в знаменателе.',
  );
}

function cli(args) {
  const [command, input, target, ...rest] = args;
  if (command === 'init' && input && target && rest.length === 0) {
    initExperiment(input, target);
    console.log('Когорта зафиксирована. CSV для ответов созданы.');
  } else if (command === 'offer' && input && target && rest.length === 0) {
    freezeOffer(input, target);
    console.log('Набор из 2–3 кандидатов и карточки зафиксированы. После отправки заполните offered_at.');
  } else if (command === 'report' && input) {
    const options = {};
    let json = false,
      tracker;
    const flags = args.slice(2);
    for (let index = 0; index < flags.length; index += 1) {
      if (flags[index] === '--json') json = true;
      else if (flags[index] === '--as-of' && flags[index + 1]) options.asOf = flags[++index];
      else if (flags[index] === '--tracker' && flags[index + 1]) tracker = flags[++index];
      else throw new Error('Неизвестный или неполный параметр отчёта.');
    }
    const report = reportExperiment(input, options);
    if (tracker) writePrivate(tracker, stringifyCsv(Object.keys(report.tracker[0] ?? {}), report.tracker));
    if (json) console.log(JSON.stringify({ ...report, tracker: undefined }, null, 2));
    else showReport(report);
  } else {
    throw new Error(
      'Команды: init <cohort.csv> <новая папка>; offer <selection.json> <папка>; report <папка> [--as-of RFC3339] [--json] [--tracker новый.csv].',
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2));
  } catch (error) {
    // Системные ошибки могут содержать пути и личные данные. Ответы никогда не печатаются.
    console.error(
      error.code
        ? 'Операция с файлами не выполнена. Проверьте путь, права и отсутствие существующих файлов.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
