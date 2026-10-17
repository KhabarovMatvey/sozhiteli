#!/usr/bin/env node
// Запускает Go-команду во всех модулях backend (у каждого сервиса свой go.mod).
//
//   node tools/go.mjs build | vet | fmt | tidy | test | test:integration | lint
//
// Через npm: npm run backend:build, backend:vet, backend:test, ...

import path from 'node:path';
import { capture, goModules, images, root, run } from './lib.mjs';

const command = process.argv[2];
const TEST_PORT = '55432';
const TEST_CONTAINER = 'sozhiteli-test-postgres';
const TEST_PASSWORD = 'integration-tests-only';

function forEachModule(args, env) {
  for (const module of goModules) {
    run('go', args, { cwd: module, env });
  }
}

// Гонки данных ищет только сборка с cgo. В CI (Linux) детектор включён через
// GO_TEST_RACE=1; в Windows без компилятора C он недоступен.
const raceFlag = process.env.GO_TEST_RACE === '1' ? ['-race'] : [];

switch (command) {
  case 'build':
    forEachModule(['build', './...']);
    break;

  case 'vet':
    forEachModule(['vet', '-tags=integration', './...']);
    break;

  case 'fmt': {
    const result = capture('gofmt', ['-l', 'backend']);
    const unformatted = result.stdout.split(/\r?\n/).filter(Boolean);
    if (unformatted.length > 0) {
      console.error('Файлы не отформатированы gofmt:\n' + unformatted.join('\n'));
      process.exit(1);
    }
    console.log('gofmt: все файлы отформатированы.');
    break;
  }

  case 'tidy': {
    // go.mod и go.sum должны соответствовать коду: воспроизводимые сборки.
    forEachModule(['mod', 'tidy', '-diff']);
    break;
  }

  case 'test':
    forEachModule(['test', '-count=1', ...raceFlag, './...']);
    break;

  case 'test:integration': {
    // В CI базу поднимает сам pipeline и передаёт TEST_DATABASE_URL.
    if (process.env.TEST_DATABASE_URL) {
      forEachModule(['test', '-count=1', '-tags=integration', ...raceFlag, './...']);
      break;
    }
    capture('docker', ['rm', '-f', TEST_CONTAINER]);
    run('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      TEST_CONTAINER,
      '-e',
      `POSTGRES_PASSWORD=${TEST_PASSWORD}`,
      '-p',
      `127.0.0.1:${TEST_PORT}:5432`,
      '--tmpfs',
      '/var/lib/postgresql',
      images.postgres,
    ]);
    let status = 1;
    try {
      waitForPostgres();
      const env = {
        TEST_DATABASE_URL: `postgres://postgres:${TEST_PASSWORD}@127.0.0.1:${TEST_PORT}/postgres?sslmode=disable`,
      };
      status = 0;
      for (const module of goModules) {
        const code = run('go', ['test', '-count=1', '-tags=integration', ...raceFlag, './...'], {
          cwd: module,
          env,
          allowFailure: true,
        });
        if (code !== 0) status = code;
      }
    } finally {
      capture('docker', ['rm', '-f', TEST_CONTAINER]);
    }
    process.exit(status);
    break;
  }

  case 'lint':
    for (const module of goModules) {
      run('docker', [
        'run',
        '--rm',
        // Только чтение: линтер ничего не пишет в репозиторий, кэш - в именованном томе.
        '-v',
        `${path.join(root, 'backend')}:/src:ro`,
        '-v',
        'sozhiteli-golangci-cache:/cache',
        '-e',
        'GOCACHE=/cache/go-build',
        '-e',
        'GOMODCACHE=/cache/go-mod',
        '-e',
        'GOLANGCI_LINT_CACHE=/cache/golangci',
        '-e',
        'GOWORK=off',
        '-w',
        `/src/${module.replace('backend/', '')}`,
        images.golangciLint,
        'golangci-lint',
        'run',
        '--config',
        '/src/.golangci.yml',
        '--build-tags',
        'integration',
        './...',
      ]);
    }
    break;

  default:
    console.error('Использование: node tools/go.mjs build|vet|fmt|tidy|test|test:integration|lint');
    process.exit(2);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // По TCP: временный сервер инициализации слушает только unix-сокет.
    const ready = capture('docker', [
      'exec',
      TEST_CONTAINER,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
    ]);
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  console.error('PostgreSQL для интеграционных тестов не запустился.');
  capture('docker', ['rm', '-f', TEST_CONTAINER]);
  process.exit(1);
}
