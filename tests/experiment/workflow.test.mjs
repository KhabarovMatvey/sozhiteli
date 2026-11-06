import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDemo, exampleSelection } from '../../tools/experiment-demo.mjs';
import {
  COHORT_HEADERS,
  freezeOffer,
  initExperiment,
  readExperiment,
  renderCards,
  reportExperiment,
  validateSelection,
} from '../../tools/experiment.mjs';
import { stringifyCsv } from '../../tools/experiment-results.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = new Date('2026-10-09T12:00:00Z');
const COHORT_NOW = new Date('2026-10-01T08:30:00Z');
const OFFER_NOW = new Date('2026-10-01T09:30:00Z');

function workspace(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'sozhiteli-experiment-'));
  t.after(() => {
    // Удаляется только собственная временная папка теста, после проверки абсолютного пути.
    const resolved = realpathSync(base);
    assert.equal(path.dirname(resolved).toLowerCase(), realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('sozhiteli-experiment-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  return base;
}

function setup(t) {
  const base = workspace(t);
  const cohortFile = path.join(base, 'cohort.csv');
  writeFileSync(
    cohortFile,
    stringifyCsv(COHORT_HEADERS, [
      { participant_id: 'P001', questionnaire_received_at: '2026-10-01T08:00:00Z' },
    ]),
  );
  const directory = path.join(base, 'Исследование с пробелами');
  const cohort = initExperiment(cohortFile, directory, { now: COHORT_NOW });
  const selection = exampleSelection();
  const selectionFile = path.join(base, 'selection.json');
  writeFileSync(selectionFile, JSON.stringify(selection));
  return { base, cohortFile, directory, cohort, selection, selectionFile };
}

test('complete synthetic experiment reaches exactly both thresholds, preserves refusals and unknowns', (t) => {
  const directory = path.join(workspace(t), 'demo');
  const report = createDemo(directory);
  assert.equal(report.mvp1.percent, 60);
  assert.equal(report.mvp2.percent, 30);
  assert.equal(report.mvp1.unknown, 2);
  assert.equal(report.mvp2.unknown, 2);
  assert.equal(report.completed_decisions, 8);
  assert.equal(report.followup_respondents, 8);
  assert.equal(report.completed_both, 8);
  assert.equal(report.tracker.find((row) => row.participant_id === 'P002').selected_candidate_id, 'none');
});

test('initial cohort includes participants before cards are sent and cannot be overwritten', (t) => {
  const { cohortFile, directory } = setup(t);
  const report = reportExperiment(directory, { asOf: NOW.toISOString() });
  assert.equal(report.participants, 1);
  assert.equal(report.mvp1.unknown, 1);
  assert.equal(report.mvp2.unknown, 1);
  assert.equal(report.result, 'pending');
  assert.throws(() => initExperiment(cohortFile, directory, { now: NOW }));
});

test('frozen offer retains candidate order, supplements and source v1 without overwriting', (t) => {
  const { directory, selectionFile } = setup(t);
  freezeOffer(selectionFile, directory, { now: OFFER_NOW });
  const data = readExperiment(directory);
  assert.deepEqual(
    data.offers[0].candidates.map((candidate) => candidate.candidate_id),
    ['C001', 'C002'],
  );
  const card = readFileSync(path.join(directory, 'cards', 'P001.md'), 'utf8');
  assert.ok(card.includes('Шум и часы тишины'));
  assert.ok(card.includes('Личное пространство'));
  assert.ok(card.includes('Поздно работаю'));
  assert.ok(card.includes('Никто не подошёл'));
  assert.throws(() => freezeOffer(selectionFile, directory, { now: OFFER_NOW }), /перезапись/);
});

test('stale confirmations cannot be frozen as current proposals', (t) => {
  const { directory, selectionFile } = setup(t);
  assert.throws(() => freezeOffer(selectionFile, directory, { now: NOW }), /актуальность/);
});

test('selection refuses incomplete, unsafe, unconsented or incompatible candidate evidence', (t) => {
  const { cohort } = setup(t);
  const cases = [
    (value) => value.candidates.pop(),
    (value) => value.candidates.push(...structuredClone(value.candidates)),
    (value) => {
      value.candidates[1].candidate_id = 'C001';
    },
    (value) => {
      value.candidates[0].share_consent = false;
    },
    (value) => {
      value.candidates[0].district_confirmed = false;
    },
    (value) => {
      value.candidates[0].conditions_confirmed = false;
    },
    (value) => {
      delete value.candidates[0].profile.household.noise;
    },
    (value) => {
      value.participant_profile.household.personal_space = '';
    },
    (value) => {
      value.candidates[0].profile.contact = 'private';
    },
    (value) => {
      value.candidates[0].profile.household.guests = '@private';
    },
    (value) => {
      value.candidates[0].profile.city = 'Другой город';
    },
    (value) => {
      value.candidates[0].profile.budget_min_rub = 26000;
      value.candidates[0].profile.budget_max_rub = 30000;
    },
    (value) => {
      value.candidates[0].profile.move_in_from = '2027-01-01';
      value.candidates[0].profile.move_in_to = '2027-01-02';
    },
    (value) => {
      value.candidates[0].active_confirmed_at = '2026-09-01T08:00:00Z';
    },
    (value) => {
      value.prepared_at = '2026-10-01T24:00:00Z';
    },
    (value) => {
      value.candidates[0].profile.move_in_from = '2026-02-30';
    },
    (value) => {
      value.participant_id = '../P001';
    },
  ];
  for (const mutate of cases) {
    const selection = exampleSelection();
    mutate(selection);
    assert.throws(() => validateSelection(selection, cohort, { now: NOW }));
  }
});

test('archived evidence and participant-facing cards detect changes', (t) => {
  for (const target of ['cohort.json', 'offers/P001.json', 'cards/P001.md']) {
    const { directory, selectionFile } = setup(t);
    freezeOffer(selectionFile, directory, { now: OFFER_NOW });
    const filename = path.join(directory, target);
    writeFileSync(filename, `${readFileSync(filename, 'utf8')} `);
    assert.throws(() => readExperiment(directory), /изменены/);
  }
});

test('rendered answers cannot introduce Markdown links or HTML', () => {
  const selection = exampleSelection();
  selection.participant_profile.household.noise =
    '<script>alert(1)</script> [текст](адрес) | новая строка\nответ';
  const card = renderCards(selection);
  assert.ok(!card.includes('<script>'));
  assert.ok(!card.includes('[текст]'));
  assert.ok(card.includes('\\| новая строка<br>ответ'));
});

test('CLI report emits aggregates without respondent text; export refuses to overwrite files', (t) => {
  const base = workspace(t);
  createDemo(path.join(base, 'demo'));
  const directory = path.join(base, 'demo', 'run');
  const args = [
    path.join(root, 'tools', 'experiment.mjs'),
    'report',
    directory,
    '--as-of',
    NOW.toISOString(),
    '--json',
  ];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.participants, 10);
  assert.equal(report.tracker, undefined);
  assert.ok(!result.stdout.includes('Ориентировался'));
  const future = spawnSync(
    process.execPath,
    args.map((value, index) => (index === 4 ? '2999-01-01T00:00:00Z' : value)),
    {
      encoding: 'utf8',
    },
  );
  assert.equal(future.status, 1);
  const exportFile = path.join(base, 'tracker.csv');
  const first = spawnSync(process.execPath, [...args, '--tracker', exportFile], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const second = spawnSync(process.execPath, [...args, '--tracker', exportFile], { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.ok(readFileSync(exportFile, 'utf8').includes('participant_id'));
});
