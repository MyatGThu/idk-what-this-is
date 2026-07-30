#!/usr/bin/env node
/** Scaffolds prompts/<slug>.md from the template. Usage: npm run new -- "Title" */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('usage: npm run new -- "Prompt title"');
  process.exit(1);
}

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const target = path.join(ROOT, 'prompts', `${slug}.md`);

if (existsSync(target)) {
  console.error(`prompts/${slug}.md already exists`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const template = await readFile(path.join(ROOT, 'prompts', '_TEMPLATE.md'), 'utf8');

const content = template
  .replace(/^title:.*$/m, `title: ${title}`)
  .replace(/^updated:.*$/m, `updated: ${today}`);

await writeFile(target, content);
console.log(`created prompts/${slug}.md`);
