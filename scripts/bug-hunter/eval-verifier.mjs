#!/usr/bin/env node
// Replay Bug Hunter's verifier prompt over the labelled eval set and score it.
//
// The set comes from ally-be (`GET pipeline/eval-set`): findings whose truth
// was later settled — a human rejected it as not_a_bug, a dismissal was
// reversed by a shipped fix, or the fix merged and held. Each item is replayed
// against the commit that was current when it was FOUND, in a git worktree of
// the target repo, so the verifier reads the code the original verifier read
// rather than code a fix has since changed.
//
//   node scripts/bug-hunter/eval-verifier.mjs --repo ally-be --repo-path ../ally-be
//       # dry run: fetch the set, resolve commits, print the plan and cost guess
//   node scripts/bug-hunter/eval-verifier.mjs --repo ally-be --repo-path ../ally-be --snapshot
//       # also write evals/bug-hunter/golden-set.ally-be.<date>.json for repeatable runs
//   node scripts/bug-hunter/eval-verifier.mjs --set evals/bug-hunter/golden-set.ally-be.2026-09-23.json \
//       --repo-path ../ally-be --apply --record --notes "tightened refute rule"
//       # run the model, write evals/bug-hunter/results/<ts>-<hash>.json, store the score
//
// Flags:
//   --repo <slug>          repo whose findings to fetch (omit with --set)
//   --repo-path <dir>      local clone of that repo (default ../<repo>); worktrees go under it
//   --set <file>           replay a snapshot instead of fetching
//   --snapshot             save the fetched set beside this script's evals folder
//   --limit <n>            items to fetch (default 30)
//   --include-weak         include uncontradicted verifier dismissals (weak labels)
//   --model <id>           model for the verifier (default claude-sonnet-5, the sweep's own tier)
//   --verifier <file>      prompt under test (default .claude/agents/bug-verifier.md in this repo)
//   --concurrency <n>      parallel verifier runs (default 2)
//   --apply                actually call the model; without it nothing is spent
//   --record               POST the score to ally-be (needs ALLY_BE_API_KEY)
//   --notes <text>         what changed in the prompt, stored with the score
//   --api <url>            ally-be base (default $ALLY_BE_API_URL or https://api.helloally.ai)
//
// Env: ALLY_BE_API_KEY (pipeline key), ANTHROPIC_API_KEY (or a logged-in claude),
//      CLAUDE_BIN (optional path to the claude binary).

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const allyBeRoot = resolve(here, '..', '..');
const evalsDir = join(allyBeRoot, 'evals', 'bug-hunter');
const resultsDir = join(evalsDir, 'results');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

const repo = flag('--repo');
const setFile = flag('--set');
const repoPath = resolve(flag('--repo-path', repo ? join(allyBeRoot, '..', repo) : '.'));
const limit = Number(flag('--limit', 30));
const includeWeak = has('--include-weak');
const model = flag('--model', 'claude-sonnet-5');
const verifierFile = resolve(flag('--verifier', join(allyBeRoot, '.claude', 'agents', 'bug-verifier.md')));
const concurrency = Math.max(1, Number(flag('--concurrency', 2)));
const apply = has('--apply');
const record = has('--record');
const notes = flag('--notes');
const api = (flag('--api', process.env.ALLY_BE_API_URL ?? 'https://api.helloally.ai')).replace(/\/$/, '');
const apiKey = process.env.ALLY_BE_API_KEY;

if (!repo && !setFile) fail('Pass --repo <slug> or --set <file>.');
if (!existsSync(repoPath)) fail(`--repo-path ${repoPath} does not exist. Clone the target repo there first.`);
if (!existsSync(verifierFile)) fail(`Verifier prompt not found at ${verifierFile}.`);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const verifierBody = stripFrontmatter(readFileSync(verifierFile, 'utf8'));
const promptHash = sha256(verifierBody);

// ── 1. The set ────────────────────────────────────────────────────────────────

let set;
let setHash;
if (setFile) {
  const raw = readFileSync(setFile, 'utf8');
  set = JSON.parse(raw);
  setHash = sha256(raw);
  console.log(`Loaded ${set.items.length} items from ${setFile}`);
} else {
  if (!apiKey) fail('ALLY_BE_API_KEY is required to fetch the eval set.');
  const url = `${api}/api/v1/bug-hunter/pipeline/eval-set?repo=${encodeURIComponent(repo)}&limit=${limit}${includeWeak ? '&includeWeak=true' : ''}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) fail(`Could not fetch the eval set (${res.status}): ${await res.text()}`);
  const raw = await res.text();
  set = JSON.parse(raw);
  setHash = sha256(raw);
  console.log(`Fetched ${set.items.length} items for ${repo} (${set.counts.real} real, ${set.counts.not_a_bug} not_a_bug)`);
  if (has('--snapshot')) {
    mkdirSync(evalsDir, { recursive: true });
    const out = join(evalsDir, `golden-set.${repo}.${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(out, raw);
    console.log(`Snapshot written to ${out}`);
  }
}
if (!set.items.length) fail('The eval set is empty — nothing settled to replay yet.');

const setRepo = repo ?? set.items[0].repo;
const foreign = set.items.filter((i) => i.repo !== setRepo);
if (foreign.length) fail(`Set mixes repos (${[...new Set(set.items.map((i) => i.repo))].join(', ')}); replay one repo at a time.`);

// ── 2. Pin every item to the commit current when it was found ─────────────────

git(['fetch', '--quiet', 'origin', 'master']);
const plan = set.items.map((item) => {
  const sha = git(['rev-list', '-1', `--before=${item.discoveredAt}`, 'origin/master']).trim();
  return { item, sha };
});
const unpinnable = plan.filter((p) => !p.sha);
if (unpinnable.length) console.warn(`${unpinnable.length} item(s) predate the branch history and will be skipped.`);
const runnable = plan.filter((p) => p.sha);

console.log(`\nPrompt ${promptHash.slice(0, 12)} (${verifierFile.replace(allyBeRoot + '/', '')}) on ${model}`);
console.log(`${runnable.length} items across ${new Set(runnable.map((p) => p.sha)).size} commits\n`);
for (const { item, sha } of runnable) {
  console.log(`  ${sha.slice(0, 8)}  ${item.label.padEnd(9)} ${item.labelSource.padEnd(18)} ${item.source.padEnd(13)} ${(item.file ?? item.symbol ?? '').slice(0, 60)}`);
}

if (!apply) {
  console.log(`\nDry run. ${runnable.length} verifier calls would be made; a call is typically a few cents on Sonnet and a few minutes each.`);
  console.log('Re-run with --apply to spend that, and --record to store the score in ally-be.');
  process.exit(0);
}

// ── 3. Replay ─────────────────────────────────────────────────────────────────

const claudeBin = resolveClaude();
const startedAt = Date.now();
const worktreeRoot = join(repoPath, '.eval-worktrees');
mkdirSync(worktreeRoot, { recursive: true });

const results = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, runnable.length) }, async () => {
    while (cursor < runnable.length) {
      const { item, sha } = runnable[cursor++];
      const dir = ensureWorktree(sha);
      const prompt = buildPrompt(verifierBody, item);
      const t0 = Date.now();
      let verdict = null;
      let costUsd = 0;
      let error = null;
      try {
        const out = await runClaude(claudeBin, prompt, dir);
        costUsd = Number(out.total_cost_usd ?? 0);
        verdict = parseVerdict(out.result ?? '');
        if (!verdict) error = 'unparseable verdict';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const predicted = verdict ? (verdict.refuted ? 'not_a_bug' : 'real') : null;
      const agreed = predicted === null ? null : predicted === item.label;
      results.push({
        findingId: item.findingId,
        sha,
        label: item.label,
        labelSource: item.labelSource,
        source: item.source,
        predicted,
        certainty: verdict?.certainty ?? null,
        reason: verdict?.reason ?? null,
        agreed,
        error,
        costUsd,
        durationMs: Date.now() - t0,
      });
      const mark = agreed === null ? '??' : agreed ? 'ok' : 'XX';
      console.log(`  ${mark} ${item.label.padEnd(9)} -> ${String(predicted).padEnd(9)} c=${verdict?.certainty ?? '-'}  ${(item.file ?? item.symbol ?? '').slice(0, 50)}${error ? `  (${error})` : ''}`);
    }
  }),
);

// ── 4. Score ──────────────────────────────────────────────────────────────────

const answered = results.filter((r) => r.agreed !== null);
const rate = (n, d) => (d === 0 ? null : n / d);
const agreement = rate(answered.filter((r) => r.agreed).length, answered.length);
const reals = answered.filter((r) => r.label === 'real');
const nonBugs = answered.filter((r) => r.label === 'not_a_bug');
const realRecall = rate(reals.filter((r) => r.predicted === 'real').length, reals.length);
const notABugRecall = rate(nonBugs.filter((r) => r.predicted === 'not_a_bug').length, nonBugs.length);
const bucketBy = (key) => {
  const out = {};
  for (const r of answered) {
    const k = r[key];
    out[k] ??= { items: 0, agreed: 0 };
    out[k].items += 1;
    if (r.agreed) out[k].agreed += 1;
  }
  return out;
};
const calibration = [
  ['0.0-0.5', 0, 0.5],
  ['0.5-0.7', 0.5, 0.7],
  ['0.7-0.9', 0.7, 0.9],
  ['0.9-1.0', 0.9, 1.01],
].map(([bucket, lo, hi]) => {
  const inBucket = answered.filter((r) => typeof r.certainty === 'number' && r.certainty >= lo && r.certainty < hi);
  return { bucket, items: inBucket.length, agreed: inBucket.filter((r) => r.agreed).length };
});
const summary = {
  repo: setRepo,
  promptKind: 'verifier',
  promptHash,
  model,
  setHash,
  itemCount: results.length,
  answeredCount: answered.length,
  agreement,
  realRecall,
  notABugRecall,
  perSource: bucketBy('source'),
  perLabelSource: bucketBy('labelSource'),
  calibration,
  costUsd: results.reduce((s, r) => s + r.costUsd, 0),
  durationMs: Date.now() - startedAt,
  ...(notes ? { notes } : {}),
};

mkdirSync(resultsDir, { recursive: true });
const outFile = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${promptHash.slice(0, 8)}.json`);
writeFileSync(outFile, JSON.stringify({ summary, results, verifierFile, setFile: setFile ?? null }, null, 2));

const pct = (v) => (v === null ? '  n/a' : `${(v * 100).toFixed(1)}%`);
console.log(`\nAgreement ${pct(agreement)} over ${answered.length}/${results.length} answered`);
console.log(`Real bugs kept ${pct(realRecall)} (${reals.length})   False positives caught ${pct(notABugRecall)} (${nonBugs.length})`);
for (const [k, v] of Object.entries(summary.perLabelSource)) console.log(`  ${k.padEnd(20)} ${v.agreed}/${v.items}`);
console.log(`Cost $${summary.costUsd.toFixed(2)} in ${Math.round(summary.durationMs / 1000)}s. Details: ${outFile.replace(allyBeRoot + '/', '')}`);

if (record) {
  if (!apiKey) fail('ALLY_BE_API_KEY is required to record the score.');
  const res = await fetch(`${api}/api/v1/bug-hunter/pipeline/eval-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(summary),
  });
  if (!res.ok) fail(`Could not record the score (${res.status}): ${await res.text()}`);
  console.log(`Recorded as eval run ${(await res.json()).id}`);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(argv) {
  return execFileSync('git', ['-C', repoPath, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ensureWorktree(sha) {
  const dir = join(worktreeRoot, sha.slice(0, 12));
  if (!existsSync(dir)) {
    git(['worktree', 'add', '--detach', '--quiet', dir, sha]);
  }
  return dir;
}

function stripFrontmatter(text) {
  return text.startsWith('---') ? text.replace(/^---[\s\S]*?\n---\n/, '') : text;
}

/**
 * The verifier's own instructions, then the finding exactly as the sweep
 * briefs a verifier: file, symbol, description, evidence — never the finder's
 * reasoning or any other verdict (see `buildSweepPrompt`, Phase 2).
 */
function buildPrompt(body, item) {
  return [
    body.trim(),
    '',
    '## The finding you are judging',
    '',
    `Repository: ${item.repo} (checked out in your working directory at the commit current when this was found).`,
    item.file ? `File: ${item.file}` : 'File: not identified.',
    item.symbol ? `Symbol: ${item.symbol}` : 'Symbol: not identified.',
    '',
    `Description: ${item.description}`,
    item.evidence ? `Evidence: ${item.evidence}` : '',
    '',
    'Answer with the single JSON object described above and nothing else.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function resolveClaude() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
  } catch {
    /* not on PATH */
  }
  // The VS Code extension bundles a binary; newest version wins.
  const extDir = join(process.env.HOME ?? '', '.vscode', 'extensions');
  if (existsSync(extDir)) {
    const candidates = readdirSync(extDir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
      .map((d) => join(extDir, d, 'resources', 'native-binary', 'claude'))
      .filter(existsSync);
    if (candidates.length) return candidates[0];
  }
  fail('No claude binary found. Install Claude Code or set CLAUDE_BIN.');
}

function runClaude(bin, prompt, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      bin,
      [
        '-p',
        prompt,
        '--model',
        model,
        // Read-only judgement: the verifier agent definition grants these
        // same tools. Bash is needed for `git log`; the prompt forbids edits.
        '--allowedTools',
        'Read,Glob,Grep,Bash',
        '--max-turns',
        '40',
        '--output-format',
        'json',
      ],
      { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !out.trim()) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      try {
        resolvePromise(JSON.parse(out));
      } catch {
        reject(new Error(`claude output was not JSON: ${out.slice(0, 200)}`));
      }
    });
  });
}

function parseVerdict(text) {
  const candidates = [text, ...(text.match(/\{[\s\S]*?\}/g) ?? [])];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      if (typeof obj?.refuted === 'boolean') {
        const certainty = typeof obj.certainty === 'number' ? Math.min(1, Math.max(0, obj.certainty)) : null;
        return { refuted: obj.refuted, certainty, reason: typeof obj.reason === 'string' ? obj.reason : null };
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
