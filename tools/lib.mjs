// Общие помощники для скриптов из tools/. Скрипты написаны на Node.js, чтобы
// одинаково работать в Windows, macOS, Linux и CI без make и bash.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const goModules = [
  'backend/platform',
  'backend/services/profile',
  'backend/services/matching',
  'backend/services/interaction',
];

export const services = ['profile', 'matching', 'interaction'];

// Версии инструментов, запускаемых из контейнеров. Менять только осознанно:
// от них зависит содержимое сгенерированного кода.
export const images = {
  sqlc: 'sqlc/sqlc:1.31.1',
  golangciLint: 'golangci/golangci-lint:v2.14.0',
  postgres: 'postgres:18.6-alpine',
  k6: 'grafana/k6:2.3.0',
};

// Запускает команду, показывая её вывод. При ошибке завершает процесс.
export function run(command, args, options = {}) {
  const cwd = options.cwd ? path.join(root, options.cwd) : root;
  console.log(`> ${options.cwd ? `[${options.cwd}] ` : ''}${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
    shell: false,
  });
  if (result.error) {
    console.error(`Не удалось запустить ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

// Запускает команду и возвращает её вывод; ошибку не считает фатальной.
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ? path.join(root, options.cwd) : root,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// Аргументы docker run для монтирования каталога репозитория. В Linux файлы,
// созданные в контейнере, должны принадлежать текущему пользователю.
export function dockerMount(relativeDir, target) {
  const args = ['-v', `${path.join(root, relativeDir)}:${target}`];
  if (typeof process.getuid === 'function') {
    args.push('--user', `${process.getuid()}:${process.getgid()}`);
  }
  return args;
}

// Переменные локальной среды из deploy/compose/.env.
export function composeEnv() {
  return Object.fromEntries(
    readFileSync(path.join(root, 'deploy/compose/.env'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

// Выполняет SQL в базе локальной среды от имени суперпользователя и
// возвращает вывод psql без оформления (поля разделены табуляцией).
// ТОЛЬКО для инструментов разработки: сервисы ходят в базы своими ролями.
export function psql(database, statement) {
  const env = composeEnv();
  return execFileSync(
    'docker',
    [
      'compose',
      '-f',
      path.join(root, 'deploy/compose/compose.yaml'),
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${env.POSTGRES_SUPERUSER_PASSWORD}`,
      'postgres',
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-F',
      '\t',
      // Запрос - через stdin: длинный текст не упирается в лимит длины
      // командной строки Windows.
      '-f',
      '-',
    ],
    { encoding: 'utf8', input: statement, maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

// Идентификаторы демо-анкет (tools/demo-data.mjs) начинаются с этого
// префикса: по нему демо-данные удаляются и исключаются из метрик.
export const demoIdPrefix = 'de000000-';
export const demoIdPattern = `${demoIdPrefix}%`;
