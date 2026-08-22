#!/usr/bin/env node
/**
 * Generates src/api/schema.d.ts from the backend's OpenAPI document.
 *
 * `openapi-typescript` (and the TS compiler API it depends on) is incompatible
 * with `typescript@7`, which this project pins for the app itself (TS 7 is the
 * native/Go-based compiler rewrite and does not expose the old `ts.factory`
 * JS API that `openapi-typescript` needs). Rather than downgrading the whole
 * project's TypeScript, generation runs in an isolated scratch directory
 * (`.openapi-gen/`, gitignored) with its own nested `node_modules` pinned to
 * `typescript@5`, so Node's module resolution picks that copy up instead of
 * the root project's `typescript@7`.
 *
 * Usage:
 *   node scripts/generate-api-schema.mjs            # writes src/api/schema.d.ts
 *   node scripts/generate-api-schema.mjs --check     # fails (exit 1) on drift
 *
 * Env:
 *   API_URL — base URL of a running API (default http://localhost:5106)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const genDir = path.join(root, '.openapi-gen');
const apiUrl = process.env.API_URL ?? 'http://localhost:5106';
const outFile = path.join(root, 'src', 'api', 'schema.d.ts');
const check = process.argv.includes('--check');

if (!existsSync(genDir)) mkdirSync(genDir, { recursive: true });
if (!existsSync(path.join(genDir, 'package.json'))) {
  writeFileSync(path.join(genDir, 'package.json'), JSON.stringify({ name: 'openapi-gen', private: true }, null, 2));
}
if (!existsSync(path.join(genDir, 'node_modules', 'openapi-typescript'))) {
  console.log('[generate-api-schema] installing openapi-typescript@7 + typescript@5 (isolated)…');
  execFileSync('npm', ['install', 'openapi-typescript@7', 'typescript@5', '--no-audit', '--no-fund'], {
    cwd: genDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const scratchOut = path.join(genDir, 'schema.d.ts');
console.log(`[generate-api-schema] fetching ${apiUrl}/openapi/v1.json …`);
execFileSync('npx', ['openapi-typescript', `${apiUrl}/openapi/v1.json`, '-o', scratchOut], {
  cwd: genDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const generated = readFileSync(scratchOut, 'utf8');

if (check) {
  const existing = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  if (existing !== generated) {
    console.error('[generate-api-schema] src/api/schema.d.ts is out of date. Run: npm run api:schema');
    process.exit(1);
  }
  console.log('[generate-api-schema] schema.d.ts matches the API — no drift.');
} else {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, generated);
  console.log(`[generate-api-schema] wrote ${path.relative(root, outFile)}`);
}
