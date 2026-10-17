#!/usr/bin/env node
// Кодогенерация из контрактов и SQL. Единственный способ менять сгенерированный код.
//
//   npm run gen         перегенерировать всё
//   npm run gen:check   перегенерировать и упасть, если результат отличается от
//                       закоммиченного (используется в CI)
//
// Что генерируется:
//   contracts/openapi/*.yaml          -> backend/services/*/internal/**/**.gen.go   (oapi-codegen)
//   backend/services/*/internal/store/queries/*.sql + migrations/*.sql
//                                     -> backend/services/*/internal/store/*.go      (sqlc)
//   contracts/openapi/<public>.yaml   -> packages/api-client/src/generated/*.ts      (openapi-typescript)

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { capture, dockerMount, images, root, run, services } from './lib.mjs';

// Какой контракт каким конфигом oapi-codegen превращается в код какого сервиса.
const goTargets = [
  { service: 'profile', config: 'oapi-codegen.public.yaml', spec: 'profile.v1.yaml' },
  { service: 'profile', config: 'oapi-codegen.internal.yaml', spec: 'profile-internal.v1.yaml' },
  { service: 'matching', config: 'oapi-codegen.public.yaml', spec: 'matching.v1.yaml' },
  { service: 'matching', config: 'oapi-codegen.profile-client.yaml', spec: 'profile-internal.v1.yaml' },
  { service: 'interaction', config: 'oapi-codegen.public.yaml', spec: 'interaction.v1.yaml' },
];

// Только публичные контракты: клиентские приложения не знают о внутренних API.
const tsTargets = ['profile', 'matching', 'interaction'];

const generatedPaths = [
  'backend/services/profile/internal/api/api.gen.go',
  'backend/services/profile/internal/internalapi/api.gen.go',
  'backend/services/matching/internal/api/api.gen.go',
  'backend/services/matching/internal/profileclient/client.gen.go',
  'backend/services/interaction/internal/api/api.gen.go',
  'backend/services/profile/internal/store',
  'backend/services/matching/internal/store',
  'backend/services/interaction/internal/store',
  'packages/api-client/src/generated',
];

for (const target of goTargets) {
  run(
    'go',
    [
      'tool',
      '-modfile=../../tools/go.mod',
      'oapi-codegen',
      '-config',
      target.config,
      `../../../contracts/openapi/${target.spec}`,
    ],
    // Инструмент берётся из отдельного модуля backend/tools; -modfile несовместим с go.work.
    { cwd: `backend/services/${target.service}`, env: { GOWORK: 'off' } },
  );
}

for (const service of services) {
  const queriesDir = path.join(root, 'backend/services', service, 'internal/store/queries');
  const hasQueries = existsSync(queriesDir) && readdirSync(queriesDir).some((file) => file.endsWith('.sql'));
  if (!hasQueries) {
    console.log(`> [${service}] sqlc пропущен: в internal/store/queries нет .sql файлов`);
    continue;
  }
  // HOME и кэш - во временном каталоге: контейнер запускается от текущего пользователя.
  run('docker', [
    'run',
    '--rm',
    ...dockerMount(`backend/services/${service}`, '/src'),
    '-w',
    '/src',
    '-e',
    'HOME=/tmp',
    '-e',
    'XDG_CACHE_HOME=/tmp/.cache',
    images.sqlc,
    'generate',
  ]);
}

// CLI запускаются как обычные скрипты Node.js: так не нужна оболочка (npx.cmd в Windows).
for (const name of tsTargets) {
  run(process.execPath, [
    'node_modules/openapi-typescript/bin/cli.js',
    `contracts/openapi/${name}.v1.yaml`,
    '--output',
    `packages/api-client/src/generated/${name}.ts`,
  ]);
}
run(process.execPath, [
  'node_modules/prettier/bin/prettier.cjs',
  '--write',
  '--log-level',
  'warn',
  'packages/api-client/src/generated',
]);

if (process.argv.includes('--check')) {
  const status = capture('git', ['status', '--porcelain', '--', ...generatedPaths]);
  if (status.stdout.trim() !== '') {
    console.error(
      '\nСгенерированный код не соответствует контрактам. Выполните `npm run gen` и закоммитьте результат:',
    );
    console.error(status.stdout);
    process.exit(1);
  }
  console.log('\nСгенерированный код соответствует контрактам.');
}
