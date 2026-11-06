import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeResults,
  DECISION_HEADERS,
  FOLLOWUP_HEADERS,
  parseCsv,
  stringifyCsv,
} from '../../tools/experiment-results.mjs';

const AS_OF = '2026-10-20T12:00:00Z';
const RECEIVED = '2026-10-01T09:00:00Z';
const COHORT_FROZEN = '2026-10-01T10:00:00Z';
const PREPARED = '2026-10-02T09:00:00Z';
const OFFER_FROZEN = '2026-10-02T10:00:00Z';
const OFFERED = '2026-10-03T09:00:00Z';
const DECIDED = '2026-10-03T10:00:00Z';
const RESPONDED = '2026-10-10T09:00:00Z';

function data(count = 1) {
  const participants = Array.from({ length: count }, (_, index) => ({
    participant_id: `P${index + 1}`,
    questionnaire_received_at: RECEIVED,
  }));
  return {
    cohort: { schema_version: 1, frozen_at: COHORT_FROZEN, participants },
    offers: participants.map(({ participant_id }) => ({
      participant_id,
      prepared_at: PREPARED,
      frozen_at: OFFER_FROZEN,
      candidates: [
        { candidate_id: 'C1', active_confirmed_at: OFFER_FROZEN },
        { candidate_id: 'C2', active_confirmed_at: OFFER_FROZEN },
      ],
    })),
    decisions: participants.map(({ participant_id }) => ({
      participant_id,
      offered_at: OFFERED,
      status: 'answered',
      selected_candidate_id: 'C1',
      reason: 'Решил обсудить одинаковый режим сна.',
      household_influenced: 'yes',
      influenced_details: 'Оба ложимся до 23:00.',
      decided_at: DECIDED,
    })),
    followups: participants.flatMap(({ participant_id }) => [
      {
        participant_id,
        candidate_id: 'C1',
        status: 'answered',
        responded_at: RESPONDED,
        bilateral: 'yes',
        household_discussed: 'yes',
        discussion_details: 'Договорились о тишине после 23:00.',
        agreement: 'yes',
        outcome: 'Продолжаем поиск квартиры вместе.',
      },
      {
        participant_id,
        candidate_id: 'C2',
        status: 'answered',
        responded_at: RESPONDED,
        bilateral: 'no',
        household_discussed: 'not_applicable',
        discussion_details: '',
        agreement: 'not_applicable',
        outcome: 'Не связывались.',
      },
    ]),
  };
}

function report(input, asOf = AS_OF) {
  return computeResults(input.cohort, input.offers, input.decisions, input.followups, {
    asOf,
    now: new Date(AS_OF),
  });
}

function unanswered(headers, extra) {
  return { ...Object.fromEntries(headers.map((header) => [header, ''])), ...extra };
}

test('CSV supports UTF-8 BOM, CRLF, commas, escaped quotes and multiline responses', () => {
  const csv = '\uFEFFparticipant_id,reason\r\nP1,"Уборка, гости и ""тишина""\r\nпосле 23"\r\n';
  assert.deepEqual(parseCsv(csv), [{ participant_id: 'P1', reason: 'Уборка, гости и "тишина"\r\nпосле 23' }]);
  const rows = [{ participant_id: 'P1', reason: 'Быт, "гости"\nсон' }];
  assert.deepEqual(parseCsv(stringifyCsv(['participant_id', 'reason'], rows)), rows);
  assert.deepEqual(
    parseCsv('reason,participant_id\nпочему,P1\n', { headers: ['participant_id', 'reason'] }),
    [{ reason: 'почему', participant_id: 'P1' }],
  );
});

test('CSV rejects malformed quoting, duplicate headers, missing and excess columns', () => {
  for (const input of ['a,a\n1,2\n', 'a,b\n1\n', 'a\n1,2\n', 'a\n"unclosed', 'a\n"x"y', 'a\nx"y']) {
    assert.throws(() => parseCsv(input));
  }
  assert.throws(() => parseCsv('a\n1\n', { headers: ['b'] }));
  assert.throws(() => parseCsv(''));
});

test('CSV exports guard spreadsheet formula injection', () => {
  const dangerous = ['=HYPERLINK("bad")', '+123', '-formula', '@formula', ' \t=SUM(1)', 'normal'];
  const exported = parseCsv(
    stringifyCsv(
      ['answer'],
      dangerous.map((answer) => ({ answer })),
    ),
  );
  assert.deepEqual(
    exported.map(({ answer }) => answer),
    dangerous.map((answer, index) => (index < 5 ? `'${answer}` : answer)),
  );
});

test('actual self-reports meet both thresholds with mature windows', () => {
  const result = report(data());
  assert.equal(result.result, 'success');
  assert.equal(result.participants, 1);
  assert.equal(result.completed_decisions, 1);
  assert.equal(result.followup_respondents, 1);
  assert.equal(result.completed_both, 1);
  assert.equal(result.mvp1.percent, 100);
  assert.equal(result.mvp2.percent, 100);
  assert.equal(result.tracker[0].followup_due_at, new Date(RESPONDED).toISOString());
});

test('fixed cohort denominators include missing, declined and no-response decisions', () => {
  const input = data(5);
  input.decisions[1] = unanswered(DECISION_HEADERS, {
    participant_id: 'P2',
    offered_at: OFFERED,
    status: 'no_response',
  });
  input.decisions[2] = unanswered(DECISION_HEADERS, {
    participant_id: 'P3',
    offered_at: OFFERED,
    status: 'declined',
  });
  input.decisions.pop();
  input.followups = [];
  const result = report(input);
  assert.equal(result.mvp1.denominator, 5);
  assert.equal(result.mvp1.numerator, 2);
  assert.equal(result.mvp1.unknown, 3);
  assert.equal(result.mvp1.percent, 40);
  assert.equal(result.mvp2.unknown, 5);
  assert.equal(result.result, 'pending');
  assert.equal(result.tracker[4].decision_status, 'pending');
});

test('rejecting everyone can count as using household information', () => {
  const input = data();
  input.decisions[0].selected_candidate_id = 'none';
  input.decisions[0].reason = 'Никто не подошёл из-за гостей и режима сна.';
  const result = report(input);
  assert.equal(result.mvp1.numerator, 1);
  assert.equal(result.tracker[0].selected_candidate_id, 'none');
});

test('explicit no is distinguished from unknown, missing responses and refusals', () => {
  const input = data(4);
  input.decisions[0].household_influenced = 'no';
  input.decisions[0].influenced_details = '';
  input.decisions[1].household_influenced = 'unknown';
  input.followups = [
    ...input.followups.slice(0, 2).map((row) => ({
      ...row,
      bilateral: 'no',
      household_discussed: 'not_applicable',
      discussion_details: '',
      agreement: 'not_applicable',
    })),
    unanswered(FOLLOWUP_HEADERS, { participant_id: 'P2', candidate_id: '', status: 'declined' }),
    unanswered(FOLLOWUP_HEADERS, { participant_id: 'P3', candidate_id: '', status: 'no_response' }),
  ];
  const result = report(input);
  assert.equal(result.mvp1.known_negative, 1);
  assert.equal(result.mvp1.unknown, 1);
  assert.equal(result.mvp2.known_negative, 1);
  assert.equal(result.mvp2.unknown, 3);
  assert.equal(result.followup_respondents, 1);
  assert.deepEqual(
    result.tracker.map((row) => row.followup_status),
    ['answered', 'declined', 'no_response', 'pending'],
  );
});

test('one participant is counted once even after household discussion with two candidates', () => {
  const input = data();
  input.followups[1] = { ...input.followups[0], candidate_id: 'C2' };
  assert.equal(report(input).mvp2.numerator, 1);
});

test('communication with one candidate cannot be combined with discussion with another', () => {
  const input = data();
  input.followups[0].household_discussed = 'no';
  input.followups[0].discussion_details = '';
  input.followups[0].agreement = 'not_applicable';
  input.followups[1].household_discussed = 'yes';
  input.followups[1].discussion_details = 'Обсудили тишину.';
  assert.throws(() => report(input), /requires bilateral/);
});

test('communication without household discussion is a known negative for that pair', () => {
  const input = data();
  input.followups[0].household_discussed = 'no';
  input.followups[0].discussion_details = '';
  input.followups[0].agreement = 'not_applicable';
  const result = report(input);
  assert.equal(result.mvp2.numerator, 0);
  assert.equal(result.mvp2.known_negative, 1);
  assert.equal(result.result, 'failure');
});

test('participant can explicitly report no agreement when communication did not occur', () => {
  const input = data();
  Object.assign(input.followups[0], {
    bilateral: 'no',
    household_discussed: 'not_applicable',
    discussion_details: '',
    agreement: 'no',
  });
  assert.equal(report(input).mvp2.known_negative, 1);
});

test('unknown communication and discussion remain unknown instead of becoming explicit negatives', () => {
  const input = data();
  Object.assign(input.followups[0], {
    bilateral: 'unknown',
    household_discussed: 'unknown',
    discussion_details: '',
    agreement: 'unknown',
  });
  const result = report(input);
  assert.equal(result.mvp2.known_negative, 0);
  assert.equal(result.mvp2.unknown, 1);
  assert.equal(result.followup_respondents, 1);
});

test('an unanswered offered pair leaves participant outcome unknown unless another pair is positive', () => {
  const input = data();
  input.followups = [input.followups[1]];
  assert.equal(report(input).mvp2.unknown, 1);
  input.followups = [data().followups[0]];
  assert.equal(report(input).mvp2.numerator, 1);
});

test('60 and 30 percent thresholds are inclusive and both must pass', () => {
  const input = data(10);
  input.decisions.forEach((row, index) => {
    if (index >= 6) {
      row.household_influenced = 'no';
      row.influenced_details = '';
    }
  });
  input.followups.forEach((row, index) => {
    if (index >= 6)
      Object.assign(row, {
        bilateral: 'no',
        household_discussed: 'not_applicable',
        discussion_details: '',
        agreement: 'not_applicable',
      });
  });
  const result = report(input);
  assert.equal(result.mvp1.percent, 60);
  assert.equal(result.mvp2.percent, 30);
  assert.equal(result.result, 'success');
  input.decisions[0].household_influenced = 'no';
  assert.equal(report(input).result, 'failure');
});

test('empty cohort and not-yet-offered participants never produce false success', () => {
  const empty = report(data(0));
  assert.equal(empty.result, 'pending');
  assert.equal(empty.mvp1.percent, null);
  assert.equal(empty.thresholds_met, false);
  const input = data();
  input.offers = [];
  input.decisions = [];
  input.followups = [];
  const result = report(input);
  assert.equal(result.participants, 1);
  assert.equal(result.mvp1.denominator, 1);
  assert.equal(result.observation_windows_mature, false);
});

test('day seven uses actual delivery timestamp and timezone offsets', () => {
  const input = data();
  input.decisions[0].offered_at = '2026-10-03T14:00:00+05:00';
  assert.equal(report(input).tracker[0].followup_due_at, new Date(RESPONDED).toISOString());
  input.followups[0].responded_at = '2026-10-10T08:59:59Z';
  assert.throws(() => report(input), /before seven-day/);
});

test('immature windows are pending; mature unknowns stay visible in observed results', () => {
  const input = data();
  input.followups = [];
  const early = report(input, '2026-10-05T09:00:00Z');
  assert.equal(early.observation_windows_mature, false);
  assert.equal(early.result, 'pending');
  const mature = report(input);
  assert.equal(mature.observation_windows_mature, true);
  assert.equal(mature.result, 'failure');
  assert.equal(mature.mvp2.unknown, 1);
  input.followups = data().followups;
  input.decisions[0].household_influenced = 'unknown';
  assert.equal(report(input).result, 'failure');
  assert.equal(report(input).mvp1.unknown, 1);
});

test('mature conservative thresholds may succeed while nonresponses remain explicitly unknown', () => {
  const input = data(10);
  for (let index = 6; index < 10; index += 1) {
    input.decisions[index] = unanswered(DECISION_HEADERS, {
      participant_id: `P${index + 1}`,
      offered_at: OFFERED,
      status: 'no_response',
    });
  }
  input.followups = input.followups.filter((row) => ['P1', 'P2', 'P3'].includes(row.participant_id));
  const result = report(input);
  assert.equal(result.result, 'success');
  assert.equal(result.mvp1.percent, 60);
  assert.equal(result.mvp1.unknown, 4);
  assert.equal(result.mvp2.percent, 30);
  assert.equal(result.mvp2.unknown, 7);
});

test('duplicate or orphan participants, proposals, decisions and followups are rejected', () => {
  const changes = [
    (input) => input.cohort.participants.push(input.cohort.participants[0]),
    (input) => input.offers.push(input.offers[0]),
    (input) => {
      input.offers[0].participant_id = 'outsider';
    },
    (input) => input.decisions.push(input.decisions[0]),
    (input) => {
      input.decisions[0].participant_id = 'outsider';
    },
    (input) => input.followups.push(input.followups[0]),
    (input) => {
      input.followups[0].participant_id = 'outsider';
    },
    (input) => {
      input.followups[0].candidate_id = 'outsider';
    },
    (input) => {
      input.decisions[0].selected_candidate_id = 'outsider';
    },
    (input) => {
      input.offers[0].candidates[1].candidate_id = 'C1';
    },
  ];
  for (const change of changes) {
    const input = data();
    change(input);
    assert.throws(() => report(input));
  }
});

test('participant-wide nonresponse conflicts with answered pair records', () => {
  const input = data();
  input.followups.push(unanswered(FOLLOWUP_HEADERS, { participant_id: 'P1', status: 'no_response' }));
  assert.throws(() => report(input), /conflicts/);
});

test('responses require reasons, actual influence evidence and discussion details', () => {
  for (const field of ['reason', 'influenced_details', 'decided_at']) {
    const input = data();
    input.decisions[0][field] = '';
    assert.throws(() => report(input));
  }
  for (const field of ['discussion_details', 'outcome', 'responded_at']) {
    const input = data();
    input.followups[0][field] = '';
    assert.throws(() => report(input));
  }
});

test('unanswered states cannot contain fabricated response facts', () => {
  const input = data();
  input.decisions[0].status = 'no_response';
  assert.throws(() => report(input), /must be blank/);
  const other = data();
  other.followups[0].status = 'pending';
  assert.throws(() => report(other), /must be blank/);
});

test('invalid calendar, ambiguous, future and reversed timestamps are rejected', () => {
  for (const value of [
    '2026-02-30T09:00:00Z',
    '2026-10-03',
    '2026-10-03T09:00:00',
    '2026-10-03T25:00:00Z',
    '2026-10-03T09:00:00+25:00',
  ]) {
    const input = data();
    input.decisions[0].offered_at = value;
    assert.throws(() => report(input));
  }
  const future = data();
  future.followups[0].responded_at = '2026-10-21T09:00:00Z';
  assert.throws(() => report(future), /after report date/);
  const reversed = data();
  reversed.decisions[0].decided_at = '2026-10-02T10:00:00Z';
  assert.throws(() => report(reversed), /before candidates/);
  const before = data();
  before.decisions[0].offered_at = '2026-10-01T12:00:00Z';
  assert.throws(() => report(before), /before proposal/);
});

test('validation errors never echo participant IDs, selected IDs or free response values', () => {
  const input = data();
  input.decisions[0].selected_candidate_id = 'private-selected-id';
  input.decisions[0].reason = 'private response with contact';
  assert.throws(
    () => report(input),
    (error) => {
      assert.doesNotMatch(error.message, /private|P1|C1/);
      assert.match(error.message, /decisions row 2: selected_candidate_id/);
      return true;
    },
  );
});

test('cohort and proposal freezes must precede actual delivery and cannot reconstruct past success', () => {
  const retroactiveCohort = data();
  retroactiveCohort.cohort.frozen_at = '2026-10-04T09:00:00Z';
  retroactiveCohort.offers[0].frozen_at = '2026-10-04T10:00:00Z';
  assert.throws(() => report(retroactiveCohort), /offered_at: before cohort was frozen/);
  const retroactiveOffer = data();
  retroactiveOffer.offers[0].frozen_at = '2026-10-04T09:00:00Z';
  assert.throws(() => report(retroactiveOffer), /offered_at: before proposal was frozen/);
});

test('freeze timestamps are required, ordered after their evidence, and no later than report date', () => {
  const changes = [
    (input) => {
      delete input.cohort.frozen_at;
    },
    (input) => {
      delete input.offers[0].frozen_at;
    },
    (input) => {
      input.cohort.frozen_at = '2026-10-01T08:00:00Z';
    },
    (input) => {
      input.offers[0].frozen_at = '2026-10-01T09:30:00Z';
    },
    (input) => {
      input.offers[0].frozen_at = '2026-10-02T08:00:00Z';
    },
    (input) => {
      input.cohort.frozen_at = '2026-10-21T09:00:00Z';
    },
    (input) => {
      input.offers[0].frozen_at = '2026-10-21T09:00:00Z';
    },
  ];
  for (const change of changes) {
    const input = data();
    change(input);
    assert.throws(() => report(input));
  }
});

test('report date cannot project future results and injected current time defaults report date', () => {
  const input = data();
  assert.throws(() => report(input, '2026-10-21T12:00:00Z'), /asOf: after current time/);
  const result = computeResults(input.cohort, input.offers, input.decisions, input.followups, {
    now: new Date(AS_OF),
  });
  assert.equal(result.as_of, new Date(AS_OF).toISOString());
  assert.throws(
    () =>
      computeResults(input.cohort, input.offers, input.decisions, input.followups, {
        now: new Date('invalid'),
      }),
    /now: invalid clock/,
  );
});

test('candidate availability must be confirmed before freezing and within 24 hours of actual delivery', () => {
  const stale = data();
  stale.decisions[0].offered_at = '2026-10-03T10:00:01Z';
  stale.decisions[0].decided_at = '2026-10-03T11:00:00Z';
  assert.throws(() => report(stale), /availability confirmation is older than 24 hours/);
  const boundary = data();
  boundary.decisions[0].offered_at = '2026-10-03T10:00:00Z';
  boundary.decisions[0].decided_at = '2026-10-03T11:00:00Z';
  boundary.followups.forEach((row) => {
    row.responded_at = '2026-10-10T10:00:00Z';
  });
  assert.equal(report(boundary).result, 'success');
  const missing = data();
  delete missing.offers[0].candidates[0].active_confirmed_at;
  assert.throws(() => report(missing), /active_confirmed_at/);
  const afterFreeze = data();
  afterFreeze.offers[0].candidates[0].active_confirmed_at = '2026-10-02T10:00:01Z';
  assert.throws(() => report(afterFreeze), /active_confirmed_at: after proposal was frozen/);
});

test('private tracker retains frozen and offered candidates, decision explanations and communication outcomes', () => {
  const input = data();
  const result = report(input);
  const tracker = result.tracker[0];
  assert.equal(tracker.prepared_at, PREPARED);
  assert.equal(tracker.frozen_candidate_ids, 'C1|C2');
  assert.equal(tracker.offered_candidate_ids, 'C1|C2');
  assert.equal(tracker.reason, input.decisions[0].reason);
  assert.equal(tracker.household_influenced, 'yes');
  assert.equal(tracker.influenced_details, input.decisions[0].influenced_details);
  assert.equal(tracker.communication_candidate_ids, 'C1');
  assert.equal(tracker.household_discussed_candidate_ids, 'C1');
  assert.equal(
    tracker.followup_outcomes,
    `C1: ${input.followups[0].outcome} | C2: ${input.followups[1].outcome}`,
  );
  const { tracker: privateRows, ...aggregate } = result;
  assert.equal(privateRows.length, 1);
  const aggregateText = JSON.stringify(aggregate);
  for (const privateText of [
    input.decisions[0].reason,
    input.decisions[0].influenced_details,
    input.followups[0].outcome,
    'P1',
    'C1',
  ]) {
    assert.equal(aggregateText.includes(privateText), false);
  }
  input.decisions = [];
  input.followups = [];
  const planned = report(input).tracker[0];
  assert.equal(planned.frozen_candidate_ids, 'C1|C2');
  assert.equal(planned.offered_candidate_ids, '');
  assert.equal(planned.reason, '');
  assert.equal(planned.followup_outcomes, '');
});
