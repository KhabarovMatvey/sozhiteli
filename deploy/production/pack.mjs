#!/usr/bin/env node
// Упаковка проекта для загрузки на сервер. Запускается на своём компьютере из
// корня репозитория:
//
//   node deploy/production/pack.mjs
//       архив исходников, нужных для сборки на сервере:
//       deploy/production/out/sozhiteli-src-<время>.tar.gz
//
//   node deploy/production/pack.mjs --images --domain sozhiteli.ru
//       дополнительно собрать образы здесь и сохранить их в
//       deploy/production/out/sozhiteli-images-<время>.tar.gz - если сервер не
//       может скачать базовые образы или собирать на нём долго.
//       Адрес сайта попадает в сборку web, поэтому домен обязателен.
//
//   node deploy/production/pack.mjs --images --app-only --domain sozhiteli.ru
//       только образы самого приложения (около 100 МБ вместо 530): PostgreSQL,
//       Keycloak, nginx и Caddy сервер скачает сам.
//
// В архив попадает только то, что нужно для запуска: без node_modules,
// исходных материалов исследования (research/), локальных .env и документации.

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const include = [
  'package.json',
  'package-lock.json',
  '.dockerignore',
  'backend',
  'packages/api-client',
  'apps/web',
  'apps/mobile/package.json',
  'deploy/compose/postgres',
  'deploy/compose/edge',
  'deploy/compose/keycloak/themes',
  'deploy/production',
];
const exclude = [
  'node_modules',
  '.next',
  '.expo',
  'dist',
  '*.tsbuildinfo',
  '.env',
  '.env.local',
  'deploy/production/out',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Команда завершилась с ошибкой: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

// В Windows берём встроенный tar.exe: tar из Git Bash не понимает пути вида C:\.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

mkdirSync(out, { recursive: true });
const srcArchive = path.join(out, `sozhiteli-src-${stamp}.tar.gz`);
run(tar, ['-czf', srcArchive, ...exclude.flatMap((e) => ['--exclude', e]), ...include]);
console.log(`Исходники: ${path.relative(root, srcArchive)} (${(statSync(srcArchive).size / 1e6).toFixed(1)} МБ)`);

const args = process.argv.slice(2);
if (args.includes('--images')) {
  const domain = args[args.indexOf('--domain') + 1];
  if (!args.includes('--domain') || !domain || domain.includes('/')) {
    console.error('Укажите домен без https://, например: --images --domain sozhiteli.ru');
    process.exit(2);
  }
  // Для сборки нужен только домен; остальные переменные compose.yaml
  // обязательны лишь при запуске, здесь - заглушки.
  const env = { ...process.env, DOMAIN: domain };
  for (const name of [
    'POSTGRES_SUPERUSER_PASSWORD',
    'PROFILE_MIGRATOR_PASSWORD',
    'PROFILE_APP_PASSWORD',
    'MATCHING_MIGRATOR_PASSWORD',
    'MATCHING_APP_PASSWORD',
    'INTERACTION_MIGRATOR_PASSWORD',
    'INTERACTION_APP_PASSWORD',
    'KEYCLOAK_DB_PASSWORD',
    'KEYCLOAK_ADMIN_USERNAME',
    'KEYCLOAK_ADMIN_PASSWORD',
    'MATCHING_CLIENT_SECRET',
  ]) {
    env[name] = 'build-only';
  }
  const compose = ['compose', '--env-file', path.join(here, '.env.example'), '-f', path.join(here, 'compose.yaml')];
  run('docker', [...compose, 'build'], { env });
  const appOnly = args.includes('--app-only');
  if (!appOnly) run('docker', [...compose, 'pull', 'caddy', 'postgres', 'keycloak', 'edge'], { env });

  const images = spawnSync('docker', [...compose, 'config', '--images'], { cwd: root, env, encoding: 'utf8' })
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  const unique = [...new Set(images)].filter((image) => !appOnly || image.startsWith('sozhiteli/'));
  const imagesArchive = path.join(out, `sozhiteli-images-${stamp}.tar.gz`);
  await new Promise((resolve, reject) => {
    const save = spawn('docker', ['save', ...unique], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    save.stdout.pipe(createGzip()).pipe(createWriteStream(imagesArchive)).on('finish', resolve).on('error', reject);
    save.on('exit', (code) => code !== 0 && reject(new Error(`docker save завершился с кодом ${code}`)));
  });
  console.log(`Образы (${unique.length}): ${path.relative(root, imagesArchive)} (${(statSync(imagesArchive).size / 1e6).toFixed(0)} МБ)`);
  console.log(`Собраны для https://${domain}. Для другого домена web нужно пересобрать.`);
}
