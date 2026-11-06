// Research results use participant answers, never application events.
// No participant identifiers or free responses are included in validation errors.

export const DECISION_HEADERS = [
  'participant_id',
  'offered_at',
  'status',
  'selected_candidate_id',
  'reason',
  'household_influenced',
  'influenced_details',
  'decided_at',
];

export const FOLLOWUP_HEADERS = [
  'participant_id',
  'candidate_id',
  'status',
  'responded_at',
  'bilateral',
  'household_discussed',
  'discussion_details',
  'agreement',
  'outcome',
];

const DAY = 24 * 60 * 60 * 1000;
const STATUSES = ['pending', 'answered', 'no_response', 'declined'];
const ANSWERS = ['yes', 'no', 'unknown'];
const DISCUSSION_ANSWERS = [...ANSWERS, 'not_applicable'];

function invalid(where, field, message = 'invalid value') {
  throw new Error(`${where}: ${field}: ${message}`);
}

function text(value, where, field, required = false) {
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    invalid(where, field, required ? 'required text' : 'expected text');
  }
  return value;
}

function identifier(value, where, field) {
  text(value, where, field, true);
  if (value !== value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) {
    invalid(where, field);
  }
  return value;
}

function oneOf(value, allowed, where, field) {
  if (!allowed.includes(value)) invalid(where, field, 'unsupported state');
  return value;
}

// Explicit timezone and calendar validation avoid locale-dependent dates and
// JavaScript accepting impossible calendar dates such as February 30.
function timestamp(value, where, field) {
  text(value, where, field, true);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (!match) invalid(where, field, 'expected ISO timestamp with timezone');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    invalid(where, field, 'invalid calendar date');
  }
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) {
    invalid(where, field, 'invalid timezone');
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result)) invalid(where, field, 'invalid timestamp');
  return result;
}

function notFuture(value, asOf, where, field) {
  const result = timestamp(value, where, field);
  if (result > asOf) invalid(where, field, 'after report date');
  return result;
}

function emptyFields(row, fields, where) {
  for (const field of fields) {
    if (row[field] !== '') invalid(where, field, 'must be blank for this state');
  }
}

function requiredColumns(row, headers, where) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) invalid(where, 'row');
  const keys = Object.keys(row);
  if (keys.length !== headers.length || headers.some((field) => !Object.hasOwn(row, field))) {
    invalid(where, 'columns', 'unexpected or missing columns');
  }
  for (const field of headers) text(row[field], where, field);
}

/** Parse RFC 4180 style UTF-8 CSV, including BOM, CRLF and quoted newlines. */
export function parseCsv(source, { headers, label = 'CSV' } = {}) {
  if (typeof source !== 'string') invalid(label, 'input', 'expected text');
  const input = source.replace(/^\uFEFF/, '');
  const records = [];
  let fields = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let started = false;
  function endField() {
    fields.push(field);
    field = '';
    closed = false;
    started = false;
  }
  function endRecord() {
    endField();
    // Spreadsheet exports often end with blank lines.
    if (fields.length !== 1 || fields[0] !== '') records.push(fields);
    fields = [];
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += character;
      }
    } else if (character === ',') {
      endField();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      endRecord();
    } else if (character === '"') {
      if (started || closed) invalid(label, 'quoting', 'malformed CSV');
      quoted = true;
      started = true;
    } else {
      if (closed) invalid(label, 'quoting', 'unexpected character after closing quote');
      field += character;
      started = true;
    }
  }
  if (quoted) invalid(label, 'quoting', 'unclosed CSV field');
  if (started || closed || field !== '' || fields.length > 0) endRecord();
  if (records.length === 0) invalid(label, 'header', 'missing CSV header');
  const names = records.shift();
  if (names.some((name) => name.trim() === '') || new Set(names).size !== names.length) {
    invalid(label, 'header', 'blank or duplicate CSV column');
  }
  if (headers && (names.length !== headers.length || headers.some((name) => !names.includes(name)))) {
    invalid(label, 'header', 'unexpected or missing CSV columns');
  }
  return records.map((record, index) => {
    if (record.length !== names.length) {
      invalid(`${label} row ${index + 2}`, 'columns', 'incorrect column count');
    }
    return Object.fromEntries(names.map((name, position) => [name, record[position]]));
  });
}

/** Export spreadsheet-safe CSV. Keep the original respondent data separately. */
export function stringifyCsv(headers, rows, { guardFormulas = true } = {}) {
  const escape = (value) => {
    let result = String(value ?? '');
    if (guardFormulas && typeof value === 'string' && /^[\s\u0000]*[=+\-@]/.test(result)) {
      result = `'${result}`;
    }
    return /[",\r\n]/.test(result) ? `"${result.replaceAll('"', '""')}"` : result;
  };
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))]
    .join('\r\n')
    .concat('\r\n');
}

function metric(states, threshold) {
  const knownPositive = states.filter((state) => state === 'positive').length;
  const knownNegative = states.filter((state) => state === 'negative').length;
  const unknown = states.length - knownPositive - knownNegative;
  return {
    numerator: knownPositive,
    denominator: states.length,
    known_positive: knownPositive,
    known_negative: knownNegative,
    unknown,
    percent: states.length === 0 ? null : (knownPositive / states.length) * 100,
    threshold_percent: threshold,
    threshold_met: states.length > 0 && knownPositive * 100 >= threshold * states.length,
  };
}

/** Validate self-reports against the frozen cohort and proposals, then aggregate. */
export function computeResults(cohort, offers, decisions, followups, { asOf, now = new Date() } = {}) {
  if (now instanceof Date && !Number.isFinite(now.getTime())) invalid('report', 'now', 'invalid clock');
  const currentAt = timestamp(now instanceof Date ? now.toISOString() : now, 'report', 'now');
  const reportAt = timestamp(asOf ?? new Date(currentAt).toISOString(), 'report', 'asOf');
  if (reportAt > currentAt) invalid('report', 'asOf', 'after current time');
  if (cohort?.schema_version !== 1 || !Array.isArray(cohort.participants)) {
    invalid('cohort', 'schema', 'expected schema version 1 participants');
  }
  const cohortFrozen = notFuture(cohort.frozen_at, reportAt, 'cohort', 'frozen_at');
  for (const [name, value] of Object.entries({ offers, decisions, followups })) {
    if (!Array.isArray(value)) invalid(name, 'rows', 'expected array');
  }
  const participants = new Map();
  for (const [index, row] of cohort.participants.entries()) {
    const where = `cohort row ${index + 1}`;
    const id = identifier(row?.participant_id, where, 'participant_id');
    if (participants.has(id)) invalid(where, 'participant_id', 'duplicate participant');
    const received = notFuture(row.questionnaire_received_at, reportAt, where, 'questionnaire_received_at');
    if (received > cohortFrozen) {
      invalid(where, 'questionnaire_received_at', 'after cohort was frozen');
    }
    participants.set(id, { row, received, offer: null, decision: null, followups: new Map() });
  }
  for (const [index, offer] of offers.entries()) {
    const where = `offers row ${index + 1}`;
    const id = identifier(offer?.participant_id, where, 'participant_id');
    const participant = participants.get(id);
    if (!participant) invalid(where, 'participant_id', 'not in frozen cohort');
    if (participant.offer) invalid(where, 'participant_id', 'duplicate proposal');
    const prepared = notFuture(offer.prepared_at, reportAt, where, 'prepared_at');
    if (prepared < participant.received) invalid(where, 'prepared_at', 'before questionnaire');
    const frozen = notFuture(offer.frozen_at, reportAt, where, 'frozen_at');
    if (frozen < cohortFrozen) invalid(where, 'frozen_at', 'before cohort was frozen');
    if (frozen < prepared) invalid(where, 'frozen_at', 'before proposal preparation');
    if (!Array.isArray(offer.candidates) || offer.candidates.length < 2 || offer.candidates.length > 3) {
      invalid(where, 'candidates', 'expected 2 or 3 candidates');
    }
    const ids = new Set();
    const activeConfirmations = [];
    for (const candidate of offer.candidates) {
      const candidateID = identifier(candidate?.candidate_id, where, 'candidate_id');
      if (candidateID === 'none' || ids.has(candidateID))
        invalid(where, 'candidate_id', 'invalid or duplicate candidate');
      const confirmed = notFuture(candidate.active_confirmed_at, reportAt, where, 'active_confirmed_at');
      if (confirmed > frozen) invalid(where, 'active_confirmed_at', 'after proposal was frozen');
      ids.add(candidateID);
      activeConfirmations.push(confirmed);
    }
    participant.offer = { prepared, prepared_at: offer.prepared_at, frozen, ids, activeConfirmations };
  }
  for (const [index, row] of decisions.entries()) {
    const where = `decisions row ${index + 2}`;
    requiredColumns(row, DECISION_HEADERS, where);
    const participant = participants.get(identifier(row.participant_id, where, 'participant_id'));
    if (!participant) invalid(where, 'participant_id', 'not in frozen cohort');
    if (participant.decision) invalid(where, 'participant_id', 'duplicate decision');
    oneOf(row.status, STATUSES, where, 'status');
    let offered = null;
    if (row.offered_at !== '') {
      if (!participant.offer) invalid(where, 'offered_at', 'missing frozen proposal');
      offered = notFuture(row.offered_at, reportAt, where, 'offered_at');
      if (offered < participant.offer.prepared) invalid(where, 'offered_at', 'before proposal preparation');
      if (offered < cohortFrozen) invalid(where, 'offered_at', 'before cohort was frozen');
      if (offered < participant.offer.frozen) invalid(where, 'offered_at', 'before proposal was frozen');
      if (participant.offer.activeConfirmations.some((confirmed) => offered - confirmed > DAY)) {
        invalid(where, 'offered_at', 'candidate availability confirmation is older than 24 hours');
      }
    }
    if (row.status === 'answered') {
      if (offered === null) invalid(where, 'offered_at', 'required before decision');
      if (row.selected_candidate_id !== 'none' && !participant.offer.ids.has(row.selected_candidate_id)) {
        invalid(where, 'selected_candidate_id', 'not an offered candidate');
      }
      text(row.reason, where, 'reason', true);
      oneOf(row.household_influenced, ANSWERS, where, 'household_influenced');
      if (row.household_influenced === 'yes') text(row.influenced_details, where, 'influenced_details', true);
      const decided = notFuture(row.decided_at, reportAt, where, 'decided_at');
      if (decided < offered) invalid(where, 'decided_at', 'before candidates were offered');
    } else {
      emptyFields(
        row,
        ['selected_candidate_id', 'reason', 'household_influenced', 'influenced_details', 'decided_at'],
        where,
      );
      if (row.status !== 'pending' && offered === null)
        invalid(where, 'offered_at', 'required for recorded nonresponse');
    }
    participant.decision = { row, offered };
  }
  for (const [index, row] of followups.entries()) {
    const where = `followups row ${index + 2}`;
    requiredColumns(row, FOLLOWUP_HEADERS, where);
    const participant = participants.get(identifier(row.participant_id, where, 'participant_id'));
    if (!participant) invalid(where, 'participant_id', 'not in frozen cohort');
    oneOf(row.status, STATUSES, where, 'status');
    if (row.candidate_id === '') {
      if (!['no_response', 'declined'].includes(row.status))
        invalid(where, 'candidate_id', 'required for this state');
    } else if (!participant.offer?.ids.has(row.candidate_id)) {
      invalid(where, 'candidate_id', 'not an offered candidate');
    }
    if (participant.followups.has(row.candidate_id)) invalid(where, 'candidate_id', 'duplicate followup');
    const offered = participant.decision?.offered;
    if (offered == null) invalid(where, 'offered_at', 'required before followup');
    const due = offered + 7 * DAY;
    if (row.status === 'answered') {
      const responded = notFuture(row.responded_at, reportAt, where, 'responded_at');
      if (responded < due) invalid(where, 'responded_at', 'before seven-day followup');
      oneOf(row.bilateral, ANSWERS, where, 'bilateral');
      oneOf(row.household_discussed, DISCUSSION_ANSWERS, where, 'household_discussed');
      oneOf(row.agreement, DISCUSSION_ANSWERS, where, 'agreement');
      text(row.outcome, where, 'outcome', true);
      if (row.household_discussed === 'yes') {
        if (row.bilateral !== 'yes')
          invalid(where, 'household_discussed', 'requires bilateral communication');
        text(row.discussion_details, where, 'discussion_details', true);
      }
      if (row.bilateral === 'no' && !['no', 'not_applicable'].includes(row.household_discussed)) {
        invalid(where, 'household_discussed', 'inconsistent with no communication');
      }
      if (row.household_discussed === 'not_applicable' && row.bilateral !== 'no') {
        invalid(where, 'household_discussed', 'only applicable when communication did not occur');
      }
      if (row.agreement === 'yes' && row.household_discussed !== 'yes') {
        invalid(where, 'agreement', 'requires discussion of household conditions');
      }
    } else {
      emptyFields(
        row,
        ['responded_at', 'bilateral', 'household_discussed', 'discussion_details', 'agreement', 'outcome'],
        where,
      );
      if (row.status !== 'pending' && reportAt < due) invalid(where, 'status', 'followup is not yet due');
    }
    participant.followups.set(row.candidate_id, row);
  }

  const tracker = [];
  for (const [id, participant] of participants) {
    const { row, offer, decision, followups: answers } = participant;
    const overall = answers.get('');
    if (overall && [...answers.values()].some((answer) => answer.status === 'answered')) {
      invalid('followups', 'status', 'participant nonresponse conflicts with answered pair');
    }
    const mvp1 =
      decision?.row.status === 'answered'
        ? { yes: 'positive', no: 'negative', unknown: 'unknown' }[decision.row.household_influenced]
        : 'unknown';
    const answered = [...answers.values()].filter((answer) => answer.status === 'answered');
    const positive = answered.some(
      (answer) => answer.bilateral === 'yes' && answer.household_discussed === 'yes',
    );
    const negative =
      offer &&
      [...offer.ids].every((candidateID) => {
        const answer = answers.get(candidateID);
        return (
          answer?.status === 'answered' &&
          (answer.bilateral === 'no' || ['no', 'not_applicable'].includes(answer.household_discussed))
        );
      });
    const offered = decision?.offered ?? null;
    const due = offered === null ? null : offered + 7 * DAY;
    const followupStatus =
      overall?.status ??
      (answered.length > 0
        ? 'answered'
        : [...answers.values()].some((answer) => answer.status === 'declined')
          ? 'declined'
          : [...answers.values()].some((answer) => answer.status === 'no_response')
            ? 'no_response'
            : 'pending');
    tracker.push({
      participant_id: id,
      questionnaire_received_at: row.questionnaire_received_at,
      prepared_at: offer?.prepared_at ?? '',
      frozen_candidate_ids: offer ? [...offer.ids].join('|') : '',
      offered_at: offered === null ? '' : decision.row.offered_at,
      offered_candidate_ids: offered === null ? '' : [...offer.ids].join('|'),
      followup_due_at: due === null ? '' : new Date(due).toISOString(),
      decision_status: decision?.row.status ?? 'pending',
      selected_candidate_id: decision?.row.selected_candidate_id ?? '',
      reason: decision?.row.reason ?? '',
      household_influenced: decision?.row.household_influenced ?? '',
      influenced_details: decision?.row.influenced_details ?? '',
      communication_candidate_ids: answered
        .filter((answer) => answer.bilateral === 'yes')
        .map((answer) => answer.candidate_id)
        .join('|'),
      household_discussed_candidate_ids: answered
        .filter((answer) => answer.bilateral === 'yes' && answer.household_discussed === 'yes')
        .map((answer) => answer.candidate_id)
        .join('|'),
      followup_outcomes: answered.map((answer) => `${answer.candidate_id}: ${answer.outcome}`).join(' | '),
      stage: positive
        ? 'household_discussed'
        : answered.some((answer) => answer.bilateral === 'yes')
          ? 'communication_occurred'
          : decision?.row.status === 'answered'
            ? decision.row.selected_candidate_id === 'none'
              ? 'all_rejected'
              : 'decision_recorded'
            : offered === null
              ? 'questionnaire_received'
              : 'candidates_offered',
      mvp1_state: mvp1,
      followup_status: followupStatus,
      mvp2_state: positive ? 'positive' : negative ? 'negative' : 'unknown',
      observation_mature: due !== null && due <= reportAt,
    });
  }
  const mvp1 = metric(
    tracker.map((row) => row.mvp1_state),
    60,
  );
  const mvp2 = metric(
    tracker.map((row) => row.mvp2_state),
    30,
  );
  const mature = tracker.length > 0 && tracker.every((row) => row.observation_mature);
  const thresholdsMet = mvp1.threshold_met && mvp2.threshold_met;
  // Unknown outcomes stay in the fixed denominator and remain visible in the
  // report. These conservative observed percentages can meet the thresholds
  // even if some participants never answer.
  const pending = !mature;
  return {
    schema_version: 1,
    as_of: new Date(reportAt).toISOString(),
    participants: tracker.length,
    completed_decisions: tracker.filter((row) => row.decision_status === 'answered').length,
    followup_respondents: tracker.filter((row) => row.followup_status === 'answered').length,
    completed_both: tracker.filter(
      (row) => row.decision_status === 'answered' && row.followup_status === 'answered',
    ).length,
    unknown_results: { mvp1: mvp1.unknown, mvp2: mvp2.unknown },
    mvp1,
    mvp2,
    observation_windows_mature: mature,
    thresholds_met: thresholdsMet,
    result: pending ? 'pending' : thresholdsMet ? 'success' : 'failure',
    tracker,
  };
}
