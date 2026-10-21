#!/usr/bin/env node
//
// extract-catalog.mjs against small throwaway repos, one per kind of codebase
// it reads. Real git repos rather than file lists, because the extractor reads
// `git ls-files` — an untracked file is not in a catalog, and that has to stay
// true.
//
// Run: node scripts/builder/test/extract-catalog.test.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractCatalog } from '../extract-catalog.mjs';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message.split('\n')[0]}`);
    failures.push(name);
  }
}

/** A git repo holding `files` (path → content), all committed. */
function repo(files, { untracked = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-catalog-'));
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  for (const [file, content] of Object.entries(untracked)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

const names = (catalog, kind) =>
  catalog.entries
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.name);

test('a NestJS repo: modules, tables, versioned routes, scheduled jobs and docs', () => {
  const dir = repo(
    {
      'src/skill-experiment/skill-experiment.module.ts':
        'export class SkillExperimentModule {}',
      'src/skill-experiment/entity/skill-experiment.entity.ts':
        "@Entity('skill_experiments')\nexport class SkillExperiment {}",
      'src/skill-experiment/entity/variant.entity.ts':
        "@Entity({ name: 'skill_experiment_variants' })\nexport class V {}",
      'src/skill-experiment/controller/skill-experiment.controller.ts': [
        "@Controller({ path: 'skill-experiments', version: '1' })",
        'export class C {',
        '  @Get()\n  list() {}',
        "  @Post(':id/start')\n  start() {}",
        '}',
      ].join('\n'),
      'src/skill-experiment/service/skill-experiment-scheduler-registration.service.ts':
        "scheduledTaskRegistry.register('5min', 'skill-experiment-judge', () => run());",
      'src/skill-experiment/test/skill-experiment.spec.ts':
        "@Entity('should_not_appear')",
      'docs/skill-experiments.md':
        '# Skill experiments (auto-improve)\n\nBody.',
    },
    { untracked: { 'src/untracked/untracked.module.ts': '' } },
  );
  const catalog = extractCatalog('ally-be', dir);

  assert.deepEqual(names(catalog, 'module'), ['skill-experiment']);
  assert.deepEqual(names(catalog, 'table').sort(), [
    'skill_experiment_variants',
    'skill_experiments',
  ]);
  assert.deepEqual(names(catalog, 'route'), [
    'GET /v1/skill-experiments',
    'POST /v1/skill-experiments/:id/start',
  ]);
  assert.deepEqual(names(catalog, 'scheduled_job'), ['skill-experiment-judge']);
  const doc = catalog.entries.find((entry) => entry.kind === 'doc');
  assert.equal(doc.detail, 'Skill experiments (auto-improve)');
  assert.match(catalog.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(catalog.stats.counts.module, 1);
});

test('an Nx web repo: apps, screen routes, pages and components per app', () => {
  const dir = repo({
    'apps/ally-admin-dashboard/src/constants/common.ts': [
      'export const ApiEndpoints = { LIST: `/v1/things` };',
      'export const ROUTES = {',
      '  MANAGE_PROMPTS: "/manage-prompts",',
      '  BUILDER: "/builder",',
      '}',
    ].join('\n'),
    'apps/ally-admin-dashboard/src/pages/Builder/Builder.tsx':
      'export const Builder = () => null;',
    'apps/ally-helpline-dashboard/src/components/debrief-tab/DebriefTab.tsx':
      'export {}',
    'apps/ally-helpline-dashboard/src/components/debrief-tab/__tests__/DebriefTab.test.tsx':
      'x',
    'apps/ally-helpline-dashboard/src/components/debrief-tab/index.ts':
      'export {}',
  });
  const catalog = extractCatalog('ally-web', dir);

  assert.deepEqual(names(catalog, 'app'), [
    'ally-admin-dashboard',
    'ally-helpline-dashboard',
  ]);
  assert.deepEqual(names(catalog, 'screen_route'), [
    '/manage-prompts',
    '/builder',
  ]);
  assert.deepEqual(names(catalog, 'page'), ['Builder']);
  const components = catalog.entries.filter(
    (entry) => entry.kind === 'component',
  );
  assert.deepEqual(
    components.map((entry) => [entry.app, entry.name]),
    [
      ['ally-admin-dashboard', 'Builder'],
      ['ally-helpline-dashboard', 'DebriefTab'],
    ],
  );
});

test('a React Native repo: screens and components', () => {
  const dir = repo({
    'src/screens/SimulationFeedbackScreen/SimulationFeedbackScreen.tsx': 'x',
    'src/screens/SimulationFeedbackScreen/components/Debrief/DebriefTab.tsx':
      'x',
    'src/components/Button/Button.tsx': 'x',
  });
  const catalog = extractCatalog('ally-mobile', dir);

  assert.deepEqual(names(catalog, 'screen'), ['SimulationFeedbackScreen']);
  assert.deepEqual(names(catalog, 'component').sort(), [
    'Button',
    'DebriefTab',
    'SimulationFeedbackScreen',
  ]);
  assert.ok(
    catalog.entries.every(
      (entry) => entry.kind !== 'component' || entry.app === 'mobile',
    ),
  );
});

test('a FastAPI repo: packages and endpoints', () => {
  const dir = repo({
    'app/api/v1/endpoints/summary.py': [
      '@router.post("/scenario/evaluate", response_model=X)',
      'async def evaluate(): ...',
      "@router.get('/health')",
    ].join('\n'),
    'app/core/summaries/summary_service.py': 'class SummaryService: ...',
  });
  const catalog = extractCatalog('ally-ai', dir);

  assert.deepEqual(names(catalog, 'module'), ['api', 'core']);
  assert.deepEqual(names(catalog, 'endpoint'), [
    'POST /scenario/evaluate',
    'GET /health',
  ]);
});

test('is deterministic: the same commit gives the same catalog', () => {
  const dir = repo({
    'src/a/a.module.ts': '',
    'src/b/b.module.ts': '',
    'README.md': '# Readme',
  });
  assert.deepEqual(extractCatalog('r', dir), extractCatalog('r', dir));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
