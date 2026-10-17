#!/usr/bin/env node
// Подготовка локальной среды: создаёт файлы .env из шаблонов, если их ещё нет.
// Существующие файлы не трогает.

import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

const templates = ['deploy/compose/.env.example', 'apps/web/.env.example', 'apps/mobile/.env.example'];

for (const template of templates) {
  const source = path.join(root, template);
  const target = source.replace(/\.example$/, template.startsWith('apps/web') ? '.local' : '');
  if (!existsSync(source)) continue;
  if (existsSync(target)) {
    console.log(`уже есть: ${path.relative(root, target)}`);
    continue;
  }
  copyFileSync(source, target);
  console.log(`создан:   ${path.relative(root, target)}`);
}
