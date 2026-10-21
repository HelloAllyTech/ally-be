#!/usr/bin/env node
//
// Extract a repo's capability catalog: the things in it that a feature could
// reuse — modules, tables, routes, screens, components, scheduled jobs,
// endpoints, docs — as plain JSON, by reading the source tree.
//
// Why this exists beside the Repo Knowledge Pack: the pack is prose a model
// writes, and nothing checks it. In production two packs came back at 54 and
// 235 characters, replaced good ones, and the interview read them as the whole
// of two repos. This file has no model in it. It lists what is on disk, so it
// cannot invent a module or forget one, and a repo it can read always produces
// a catalog the size of the repo.
//
// It is deliberately shallow — names, paths, a one-line detail — because the
// interview uses it to know a place exists and where to look, then reads the
// code. A catalog that tried to describe behaviour would be a second pack.
//
// Usage: node extract-catalog.mjs <repo-name> <repo-dir>   (JSON on stdout)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Upper bound per kind, so one huge repo cannot crowd out the rest of a payload. */
const MAX_PER_KIND = 1500;
const MAX_DOCS = 400;

/** Read a tracked file, or '' when it cannot be read (binary, vanished, too big). */
function readText(dir, file) {
  try {
    const full = path.join(dir, file);
    if (fs.statSync(full).size > 400_000) return '';
    return fs.readFileSync(full, 'utf8');
  } catch {
    return '';
  }
}

function trackedFiles(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean);
}

function headSha(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

const isTest = (file) =>
  /(^|\/)(__tests__|test|tests|__mocks__)\//.test(file) ||
  /\.(spec|test)\.[jt]sx?$/.test(file);

/** First markdown heading, or the first non-empty line. */
function docTitle(text) {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 160);
  const first = text.split('\n').find((line) => line.trim());
  return (first ?? '').trim().slice(0, 160);
}

/* ── NestJS (ally-be) ─────────────────────────────────────────────────── */

function nestEntries(dir, files) {
  const entries = [];
  const moduleDirs = new Set();
  for (const file of files) {
    const m = file.match(/^src\/([^/]+)\/[^/]+\.module\.ts$/);
    if (m) moduleDirs.add(m[1]);
  }
  for (const name of [...moduleDirs].sort()) {
    entries.push({ kind: 'module', name, path: `src/${name}` });
  }

  for (const file of files) {
    if (!file.startsWith('src/') || !file.endsWith('.ts') || isTest(file))
      continue;

    if (file.endsWith('.entity.ts')) {
      const text = readText(dir, file);
      for (const match of text.matchAll(
        /@Entity\(\s*(?:'([^']+)'|"([^"]+)"|\{[^}]*name:\s*'([^']+)')/g,
      )) {
        const table = match[1] ?? match[2] ?? match[3];
        if (table) entries.push({ kind: 'table', name: table, path: file });
      }
    }

    if (file.endsWith('.controller.ts')) {
      const text = readText(dir, file);
      const base =
        text.match(/@Controller\(\s*\{[^}]*path:\s*'([^']*)'/)?.[1] ??
        text.match(/@Controller\(\s*'([^']*)'/)?.[1] ??
        '';
      const version = text.match(
        /@Controller\(\s*\{[^}]*version:\s*'([^']+)'/,
      )?.[1];
      const prefix = `${version ? `/v${version}` : ''}${base ? `/${base}` : ''}`;
      for (const match of text.matchAll(
        /@(Get|Post|Put|Patch|Delete|Sse)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g,
      )) {
        const sub = match[2] ?? match[3] ?? '';
        entries.push({
          kind: 'route',
          name: `${match[1].toUpperCase()} ${prefix}${sub ? `/${sub}` : ''}`,
          path: file,
        });
      }
    }

    if (file.includes('scheduler') || file.endsWith('.service.ts')) {
      const text = readText(dir, file);
      if (!text.includes('scheduledTaskRegistry.register(')) continue;
      for (const match of text.matchAll(
        /scheduledTaskRegistry\.register\(\s*([^,]+),\s*(?:'([^']+)'|"([^"]+)"|([A-Z0-9_]+))/g,
      )) {
        entries.push({
          kind: 'scheduled_job',
          name: match[2] ?? match[3] ?? match[4],
          detail: `every ${match[1].trim()}`,
          path: file,
        });
      }
    }
  }
  return entries;
}

/* ── Nx web apps (ally-web) ──────────────────────────────────────────── */

function webEntries(dir, files) {
  const entries = [];
  const apps = new Set();
  for (const file of files) {
    const m = file.match(/^apps\/([^/]+)\//);
    if (m) apps.add(m[1]);
  }
  for (const app of [...apps].sort()) {
    entries.push({ kind: 'app', name: app, path: `apps/${app}` });

    const constants = `apps/${app}/src/constants/common.ts`;
    if (files.includes(constants)) {
      const text = readText(dir, constants);
      // The ROUTES object: `NAME: "/path",` lines. Only string literals that
      // start with a slash, so API endpoint templates elsewhere in the file
      // (which start with /v1 inside backticks) are not mistaken for screens.
      const routes = text.match(/export const ROUTES\s*=\s*\{([\s\S]*?)\n\}/);
      if (routes) {
        for (const match of routes[1].matchAll(
          /^\s*([A-Z0-9_]+):\s*"(\/[^"]*)"/gm,
        )) {
          entries.push({
            kind: 'screen_route',
            name: match[2],
            detail: match[1],
            path: constants,
            app,
          });
        }
      }
    }
  }

  const pages = new Set();
  for (const file of files) {
    const m = file.match(/^apps\/([^/]+)\/src\/pages\/([^/]+)\//);
    if (m) pages.add(`${m[1]}\u0000${m[2]}`);
  }
  for (const key of [...pages].sort()) {
    const [app, page] = key.split('\u0000');
    entries.push({
      kind: 'page',
      name: page,
      path: `apps/${app}/src/pages/${page}`,
      app,
    });
  }

  for (const file of files) {
    const m = file.match(
      /^apps\/([^/]+)\/src\/(?:components|pages)\/.+\/([A-Z][A-Za-z0-9]+)\.tsx$/,
    );
    if (m && !isTest(file)) {
      entries.push({ kind: 'component', name: m[2], path: file, app: m[1] });
    }
  }
  return entries;
}

/* ── React Native (ally-mobile) ──────────────────────────────────────── */

function mobileEntries(dir, files) {
  const entries = [];
  const screens = new Set();
  for (const file of files) {
    const m = file.match(/^src\/screens\/([^/]+)\//);
    if (m) screens.add(m[1]);
  }
  for (const name of [...screens].sort()) {
    entries.push({ kind: 'screen', name, path: `src/screens/${name}` });
  }
  for (const file of files) {
    const m = file.match(
      /^src\/(?:screens|components)\/.+\/([A-Z][A-Za-z0-9]+)\.tsx$/,
    );
    if (m && !isTest(file)) {
      entries.push({
        kind: 'component',
        name: m[1],
        path: file,
        app: 'mobile',
      });
    }
  }
  return entries;
}

/* ── FastAPI (ally-ai, ally-ai-learn) ────────────────────────────────── */

function fastapiEntries(dir, files) {
  const entries = [];
  const packages = new Set();
  for (const file of files) {
    const m = file.match(/^app\/([^/]+)\//);
    if (m) packages.add(m[1]);
  }
  for (const name of [...packages].sort()) {
    entries.push({ kind: 'module', name, path: `app/${name}` });
  }
  for (const file of files) {
    if (!file.startsWith('app/') || !file.endsWith('.py') || isTest(file))
      continue;
    const text = readText(dir, file);
    if (!text.includes('@router.')) continue;
    for (const match of text.matchAll(
      /@router\.(get|post|put|patch|delete|websocket)\(\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      entries.push({
        kind: 'endpoint',
        name: `${match[1].toUpperCase()} ${match[2] ?? match[3]}`,
        path: file,
      });
    }
  }
  return entries;
}

/* ── Docs, every repo ────────────────────────────────────────────────── */

function docEntries(dir, files) {
  const docs = files
    .filter(
      (file) =>
        file.endsWith('.md') &&
        !file.includes('node_modules/') &&
        !/CHANGELOG/i.test(file) &&
        !file.startsWith('.github/'),
    )
    .slice(0, MAX_DOCS);
  return docs.map((file) => ({
    kind: 'doc',
    name: file,
    detail: docTitle(readText(dir, file)),
    path: file,
  }));
}

export function extractCatalog(repo, dir) {
  const files = trackedFiles(dir);
  const has = (predicate) => files.some(predicate);

  let entries = [];
  if (has((f) => /^src\/[^/]+\/[^/]+\.module\.ts$/.test(f))) {
    entries = entries.concat(nestEntries(dir, files));
  }
  if (has((f) => f.startsWith('apps/') && f.endsWith('.tsx'))) {
    entries = entries.concat(webEntries(dir, files));
  }
  if (has((f) => f.startsWith('src/screens/'))) {
    entries = entries.concat(mobileEntries(dir, files));
  }
  if (has((f) => f.startsWith('app/') && f.endsWith('.py'))) {
    entries = entries.concat(fastapiEntries(dir, files));
  }
  entries = entries.concat(docEntries(dir, files));

  // Cap per kind, keeping the first N in path order — deterministic, so two
  // runs on one commit produce byte-identical catalogs.
  const byKind = new Map();
  for (const entry of entries) {
    const list = byKind.get(entry.kind) ?? [];
    if (list.length < MAX_PER_KIND) list.push(entry);
    byKind.set(entry.kind, list);
  }
  const capped = [...byKind.values()].flat();

  const counts = {};
  for (const entry of capped)
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;

  return {
    repo,
    commitSha: headSha(dir),
    entries: capped,
    stats: { files: files.length, counts },
  };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const [repo, dir] = process.argv.slice(2);
  if (!repo || !dir) {
    console.error('usage: extract-catalog.mjs <repo-name> <repo-dir>');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(extractCatalog(repo, dir)));
}
