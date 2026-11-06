#!/usr/bin/env node
// Только вымышленные ответы: одновременно пример работы и проверка всего сценария.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_HEADERS, FOLLOWUP_HEADERS, stringifyCsv } from './experiment-results.mjs';
import { COHORT_HEADERS, freezeOffer, initExperiment, reportExperiment } from './experiment.mjs';

export function exampleSelection(participantId = 'P001', candidateIds = ['C001', 'C002']) {
  const profile = {
    questionnaire_version: 1,
    city: 'Тестовый город',
    districts: 'Центр',
    budget_min_rub: 15000,
    budget_max_rub: 25000,
    move_in_from: '2026-11-01',
    move_in_to: '2026-11-15',
    household: {
      sleep: 'Ложусь до 23:00, встаю в 07:00',
      noise: 'Тишина с 23:00 до 07:00, звонки в наушниках',
      cleaning: 'Уборка общих зон по графику',
      guests: 'Предупреждаю о гостях заранее',
      smoking: 'Не курю',
      socializing: 'Доброжелательное соседство без обязательств',
      personal_space: 'В комнату входим после стука, вещи берём с разрешения',
      dishes: 'В течение дня',
      pets: 'Животных нет',
      shared_purchases: 'Делим расходы пополам',
    },
  };
  return {
    schema_version: 1,
    participant_id: participantId,
    prepared_at: '2026-10-01T09:00:00Z',
    participant_profile: structuredClone(profile),
    candidates: candidateIds.map((candidate_id, index) => {
      const candidateProfile = structuredClone(profile);
      if (index === 1) {
        candidateProfile.household.sleep = 'Ложусь после 01:00, встаю в 09:00';
        candidateProfile.household.noise = 'Поздно работаю за компьютером, готов пользоваться наушниками';
      }
      return {
        candidate_id,
        active_confirmed_at: '2026-10-01T08:30:00Z',
        share_consent: true,
        district_confirmed: true,
        conditions_confirmed: true,
        profile: candidateProfile,
      };
    }),
  };
}

export function createDemo(directory) {
  mkdirSync(directory, { mode: 0o700 });
  const participants = Array.from({ length: 10 }, (_, index) => ({
    participant_id: `P${String(index + 1).padStart(3, '0')}`,
    questionnaire_received_at: '2026-10-01T08:00:00Z',
  }));
  const cohortFile = path.join(directory, 'cohort.csv');
  writeFileSync(cohortFile, stringifyCsv(COHORT_HEADERS, participants), { flag: 'wx', mode: 0o600 });
  const runDir = path.join(directory, 'run');
  // Вымышленное время фиксируется только здесь; обычный CLI использует реальные часы.
  initExperiment(cohortFile, runDir, { now: new Date('2026-10-01T08:30:00Z') });
  const decisions = [],
    followups = [];
  for (const [index, { participant_id }] of participants.entries()) {
    const candidateIds = [1, 2].map((offset) => `C${String(index * 2 + offset).padStart(3, '0')}`);
    const selectionFile = path.join(directory, `${participant_id}.json`);
    writeFileSync(
      selectionFile,
      `${JSON.stringify(exampleSelection(participant_id, candidateIds), null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    freezeOffer(selectionFile, runDir, { now: new Date('2026-10-01T09:30:00Z') });
    const answered = index < 8;
    decisions.push({
      participant_id,
      offered_at: '2026-10-01T10:00:00Z',
      status: answered ? 'answered' : index === 8 ? 'no_response' : 'pending',
      selected_candidate_id: answered ? (index === 1 ? 'none' : candidateIds[0]) : '',
      reason: answered
        ? index === 1
          ? 'Мне не подошли предложенные правила быта'
          : 'Условия подходят, хочу познакомиться'
        : '',
      household_influenced: answered ? (index < 6 ? 'yes' : 'no') : '',
      influenced_details: index < 6 ? 'Ориентировался на время тишины и правила личного пространства' : '',
      decided_at: answered ? '2026-10-01T11:00:00Z' : '',
    });
    if (answered) {
      for (const [pairIndex, candidate_id] of candidateIds.entries()) {
        const positive = [0, 2, 3].includes(index) && pairIndex === 0;
        followups.push({
          participant_id,
          candidate_id,
          status: 'answered',
          responded_at: '2026-10-08T12:00:00Z',
          bilateral: positive || (index === 4 && pairIndex === 0) ? 'yes' : 'no',
          household_discussed: positive ? 'yes' : index === 4 && pairIndex === 0 ? 'no' : 'not_applicable',
          discussion_details: positive
            ? 'Обсудили позднюю работу и договорились пользоваться наушниками после 23:00'
            : '',
          agreement: positive ? 'yes' : 'not_applicable',
          outcome: positive ? 'Продолжаем знакомство' : 'Бытовые условия не обсуждали',
        });
      }
    } else if (index === 8) followups.push({ participant_id, status: 'no_response' });
  }
  writeFileSync(path.join(runDir, 'decisions.csv'), stringifyCsv(DECISION_HEADERS, decisions), {
    mode: 0o600,
  });
  writeFileSync(path.join(runDir, 'followups.csv'), stringifyCsv(FOLLOWUP_HEADERS, followups), {
    mode: 0o600,
  });
  const report = reportExperiment(runDir, { asOf: '2026-10-09T12:00:00Z' });
  assert.equal(report.mvp1.numerator, 6);
  assert.equal(report.mvp2.numerator, 3);
  assert.equal(report.participants, 10);
  assert.equal(report.result, 'success');
  writeFileSync(
    path.join(directory, 'result.json'),
    `${JSON.stringify({ ...report, tracker: undefined }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(
    path.join(directory, 'tracker.csv'),
    stringifyCsv(Object.keys(report.tracker[0]), report.tracker),
    { flag: 'wx', mode: 0o600 },
  );
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || process.argv.length !== 3)
      throw new Error('Укажите новую папку: npm run experiment:demo -- research/demo');
    const result = createDemo(process.argv[2]);
    console.log(
      `Вымышленный эксперимент проверен: MVP-1 ${result.mvp1.numerator}/10, MVP-2 ${result.mvp2.numerator}/10, результат ${result.result}.`,
    );
    console.log(
      'Отчёт result.json и tracker.csv сохранены в папке примера. Эти ответы нельзя использовать как результаты исследования.',
    );
  } catch (error) {
    console.error(
      error.code
        ? 'Не удалось создать пример. Используйте новую папку внутри закрытого research/.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
