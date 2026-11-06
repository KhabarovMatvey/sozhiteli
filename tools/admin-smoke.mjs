#!/usr/bin/env node
// Read-only live checks for the running LOCAL admin panel. Account login is
// performed through the dev-only OIDC client; no product data or fixtures change.
// Passwords, tokens, cursors and returned account/table records never reach stdout.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

const EDGE = 'http://localhost:8080';
const KEYCLOAK = 'http://localhost:8081';
const ROLE = 'sozhiteli-admin';
const services = {
  profile: {
    database: 'profile_db',
    tables: {
      profile: [
        'user_id',
        'display_name',
        'birth_year',
        'gender',
        'occupation',
        'city_id',
        'districts',
        'budget_min_rub',
        'budget_max_rub',
        'move_in_from',
        'move_in_to',
        'roommate_gender',
        'questionnaire_version',
        'habits',
        'search_status',
        'created_at',
        'updated_at',
        'feed_version',
      ],
      city: ['id', 'name', 'region'],
      profile_deletion: ['user_id', 'feed_version', 'deleted_at'],
    },
  },
  matching: {
    database: 'matching_db',
    tables: {
      candidate: [
        'user_id',
        'source_version',
        'display_name',
        'birth_year',
        'gender',
        'occupation',
        'city_id',
        'districts',
        'budget_min_rub',
        'budget_max_rub',
        'move_in_from',
        'move_in_to',
        'roommate_gender',
        'questionnaire_version',
        'habits',
        'search_status',
        'profile_updated_at',
        'synced_at',
      ],
      candidate_view: ['id', 'viewer_id', 'candidate_id', 'matched_count', 'compared_count', 'viewed_at'],
      sync_state: ['source', 'feed_cursor', 'updated_at'],
    },
  },
  interaction: {
    database: 'interaction_db',
    tables: {
      contact_request: ['id', 'sender_id', 'recipient_id', 'status', 'created_at', 'responded_at'],
      contact: ['user_id', 'kind', 'updated_at'],
    },
  },
};

const endpoints = [
  '/api/profile/v1/admin/users',
  ...Object.entries(services).flatMap(([service, definition]) => [
    `/api/${service}/v1/admin/database`,
    `/api/${service}/v1/admin/tables/${Object.keys(definition.tables)[0]}`,
  ]),
];
let checks = 0;
let failed = 0;
let requests = 0;

function check(label, ok) {
  checks += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  return ok;
}

function requireCheck(label, ok) {
  if (!check(label, ok)) throw new Error('check failed');
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const noStore = (response) => response.headers.get('cache-control') === 'no-store';

async function request(url, init = {}) {
  // The edge allows 20 requests/second. Spacing also makes this script safe to
  // run while the owner is browsing the app through the same loopback address.
  if (requests) await new Promise((resolve) => setTimeout(resolve, 100));
  requests += 1;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000), ...init });
  let json = null;
  try {
    json = await response.json();
  } catch {
    // Invalid or non-JSON responses fail checks without exposing their bodies.
  }
  return { status: response.status, headers: response.headers, json };
}

async function login(username, password) {
  const response = await request(`${KEYCLOAK}/realms/sozhiteli/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'sozhiteli-dev-cli',
      username,
      password,
      scope: 'openid',
    }),
  });
  return response.status === 200 && typeof response.json?.access_token === 'string'
    ? response.json.access_token
    : null;
}

function claims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function get(route, token) {
  return request(`${EDGE}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function tableShape(data, table, columns, limit) {
  return (
    data?.table === table &&
    same(data.columns, columns) &&
    Array.isArray(data.rows) &&
    data.rows.length <= limit &&
    data.rows.every((row) => Array.isArray(row) && row.length === columns.length) &&
    (data.next_cursor === null || typeof data.next_cursor === 'string')
  );
}

async function verifyUsers(token) {
  const seenUsers = new Set();
  const seenCursors = new Set();
  let total;
  let cursor;
  let pages = 0;
  let valid = true;
  do {
    pages += 1;
    if (pages > 100) {
      valid = false;
      break;
    }
    const query = new URLSearchParams({ limit: '2', ...(cursor ? { cursor } : {}) });
    const response = await get(`/api/profile/v1/admin/users?${query}`, token);
    const data = response.json;
    if (
      response.status !== 200 ||
      !noStore(response) ||
      !Array.isArray(data?.items) ||
      data.items.length > 2 ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0 ||
      (total !== undefined && data.total !== total)
    ) {
      valid = false;
      break;
    }
    total = data.total;
    const permitted = new Set([
      'id',
      'username',
      'email',
      'enabled',
      'email_verified',
      'created_at',
      'service_account',
      'has_profile',
    ]);
    for (const user of data.items) {
      if (
        !user ||
        typeof user.id !== 'string' ||
        typeof user.has_profile !== 'boolean' ||
        seenUsers.has(user.id) ||
        !Object.keys(user).every((key) => permitted.has(key))
      ) {
        valid = false;
      }
      seenUsers.add(user.id);
    }
    cursor = data.next_cursor;
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor))) {
      valid = false;
      break;
    }
    if (cursor) seenCursors.add(cursor);
    if (cursor && data.items.length !== 2) valid = false;
  } while (cursor && valid);
  check('users: limit=2 pagination, unique IDs, total and safe fields', valid && seenUsers.size === total);
}

async function verifyCities(token, count) {
  const first = await get('/api/profile/v1/admin/tables/city?limit=2', token);
  const columns = services.profile.tables.city;
  let valid =
    first.status === 200 && noStore(first) && tableShape(first.json, 'city', columns, 2) && count > 2;
  const cursor = first.json?.next_cursor;
  valid &&= typeof cursor === 'string' && cursor.length > 0 && first.json.rows.length === 2;
  if (valid) {
    const query = new URLSearchParams({ limit: '2', cursor });
    const second = await get(`/api/profile/v1/admin/tables/city?${query}`, token);
    valid &&= second.status === 200 && noStore(second) && tableShape(second.json, 'city', columns, 2);
    if (valid) {
      const previous = first.json.rows.map((row) => Number(row[0]));
      const next = second.json.rows.map((row) => Number(row[0]));
      valid &&=
        next.length > 0 &&
        new Set([...previous, ...next]).size === previous.length + next.length &&
        Math.min(...next) > Math.max(...previous);
    }
    const crossTable = await get(`/api/profile/v1/admin/tables/profile?${query}`, token);
    check(
      'city: cursor cannot be reused for another table',
      crossTable.status === 400 && noStore(crossTable),
    );
  }
  check('city: limit=2 keyset pages are ordered without overlap', valid);
}

async function main() {
  if (process.argv.length !== 2) throw new Error('unsupported arguments');
  const saved = readFileSync(path.join(root, 'research/local-admin.txt'), 'utf8');
  const username = /^Логин: (\S+)$/m.exec(saved)?.[1];
  const password = /^Пароль: (\S+)$/m.exec(saved)?.[1];
  requireCheck(
    'private local admin credentials are available',
    username === 'adminlocal@example.test' && password,
  );
  const realm = JSON.parse(readFileSync(path.join(root, 'deploy/compose/keycloak/realm-dev.json'), 'utf8'));
  const alice = realm.users.find((user) => user.username === 'alice@example.test');
  const alicePassword = alice?.credentials?.find((credential) => credential.type === 'password')?.value;
  requireCheck('committed local test credentials are available', Boolean(alicePassword));
  const adminToken = await login(username, password);
  const ordinaryToken = await login(alice.username, alicePassword);
  requireCheck('local Keycloak grants both access tokens', Boolean(adminToken && ordinaryToken));
  const adminClaims = claims(adminToken);
  const ordinaryClaims = claims(ordinaryToken);
  requireCheck(
    'admin access token has explicit realm role; ordinary token does not',
    adminClaims.realm_access?.roles?.includes(ROLE) && !ordinaryClaims.realm_access?.roles?.includes(ROLE),
  );

  for (const route of endpoints) {
    const anonymous = await get(route);
    check(`${route}: anonymous 401 + no-store`, anonymous.status === 401 && noStore(anonymous));
    const ordinary = await get(route, ordinaryToken);
    check(`${route}: ordinary user 403 + no-store`, ordinary.status === 403 && noStore(ordinary));
    const admin = await get(route, adminToken);
    check(`${route}: administrator 200 + no-store`, admin.status === 200 && noStore(admin));
  }

  let cityCount = 0;
  for (const [service, definition] of Object.entries(services)) {
    const prefix = `/api/${service}/v1/admin`;
    const database = await get(`${prefix}/database`, adminToken);
    const data = database.json;
    const expectedTables = Object.keys(definition.tables).sort();
    check(
      `${service}: own database and exact table allowlist`,
      database.status === 200 &&
        noStore(database) &&
        data?.service === service &&
        data.database === definition.database &&
        Number.isSafeInteger(data.size_bytes) &&
        data.size_bytes >= 0 &&
        Array.isArray(data.tables) &&
        same(data.tables.map((table) => table.name).sort(), expectedTables) &&
        data.tables.every(
          (table) =>
            same(table.columns, definition.tables[table.name]) &&
            Number.isSafeInteger(table.row_count) &&
            table.row_count >= 0,
        ),
    );
    if (service === 'profile') cityCount = data?.tables?.find((table) => table.name === 'city')?.row_count;
    for (const [table, columns] of Object.entries(definition.tables)) {
      const response = await get(`${prefix}/tables/${table}?limit=2`, adminToken);
      check(
        `${service}/${table}: only allowed columns and bounded rows`,
        response.status === 200 && noStore(response) && tableShape(response.json, table, columns, 2),
      );
    }
    for (const table of ['not_an_admin_table', "profile' OR '1'='1"]) {
      const response = await get(`${prefix}/tables/${encodeURIComponent(table)}`, adminToken);
      check(
        `${service}: ${table === 'not_an_admin_table' ? 'unknown' : 'malicious'} table denied`,
        [400, 404].includes(response.status) && noStore(response),
      );
    }
    const table = Object.keys(definition.tables)[0];
    const invalid = await get(`${prefix}/tables/${table}?limit=51`, adminToken);
    check(`${service}: limit=51 rejected`, invalid.status === 400 && noStore(invalid));
  }

  const contact = await get('/api/interaction/v1/admin/tables/contact?limit=2', adminToken);
  check(
    'contact: exact metadata-only columns; contact value omitted',
    contact.status === 200 &&
      noStore(contact) &&
      same(contact.json?.columns, ['user_id', 'kind', 'updated_at']) &&
      contact.json.rows.every((row) => Array.isArray(row) && row.length === 3),
  );
  await verifyUsers(adminToken);
  await verifyCities(adminToken, cityCount);
  const invalidUsers = await get('/api/profile/v1/admin/users?limit=51', adminToken);
  check('users: limit=51 rejected', invalidUsers.status === 400 && noStore(invalidUsers));
}

main()
  .catch(() => {
    // Exception details may contain private file contents or upstream responses.
    // Only a fixed label is emitted, even when local prerequisites are missing.
    check('live admin checks completed without interruption', false);
  })
  .finally(() => {
    console.log(`Checks: ${checks}; passed: ${checks - failed}; failed: ${failed}; requests: ${requests}.`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
