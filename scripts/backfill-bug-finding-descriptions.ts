/**
 * One-off backfill: every `bug_findings` row written before the finder
 * prompts started requiring a plain-language intro (see bug-hunt.mjs and
 * bug-hunt-sweep-prompt.ts) has a description that opens straight into
 * technical detail. This script prepends a short, non-technical paragraph —
 * what's going wrong and how it affects a user — to each row's existing
 * `description`, generated from that row's own title/description/evidence.
 *
 * Safe to re-run: each processed row is marked via
 * `metadata.descriptionIntroBackfilledAt`, so a second run only picks up
 * rows a prior run didn't reach (a failure, or ones added since).
 *
 *   npm run backfill:bug-finding-descriptions -- --dry-run   # preview only
 *   npm run backfill:bug-finding-descriptions -- --limit 5   # first 5 pending rows
 *   npm run backfill:bug-finding-descriptions               # full run
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { BugFinding } from '../src/bug-hunter/entity/bug-finding.entity';

const MODEL = process.env.ANTHROPIC_AUTOFILL_MODEL || 'claude-sonnet-4-6';
const BACKFILL_METADATA_KEY = 'descriptionIntroBackfilledAt';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const flagIndex = process.argv.indexOf('--limit');
  if (flagIndex === -1) return undefined;
  const n = Number(process.argv[flagIndex + 1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();

function buildDataSource(): DataSource {
  const database = process.env.DB_DATABASE;
  if (!database) {
    throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
  }
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
    entities: [BugFinding],
    synchronize: false,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    logging: false,
  });
}

async function generateIntro(anthropic: Anthropic, finding: BugFinding): Promise<string> {
  const system = [
    'You are rewriting the opening of a bug report so a non-technical reader — a product manager or support lead with no coding background — understands it immediately.',
    'Write ONE short paragraph, 2-4 plain-English sentences: what is going wrong, and how it affects a user or their experience.',
    'No jargon, no code identifiers, no file paths, no stack traces.',
    'If the bug has no direct effect on any user (e.g. a lint error or other internal code-quality issue), say that plainly instead of inventing an impact.',
    'Return only the paragraph itself — no heading, no quotes, no "Summary:" prefix.',
  ].join(' ');

  const user = [
    `Bug title: ${finding.title}`,
    `Current description (technical): ${finding.description}`,
    finding.evidence ? `Evidence: ${finding.evidence}` : '',
    `Severity: ${finding.severity || 'unknown'}`,
    `Source: ${finding.source}`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content[0];
  const text = block?.type === 'text' ? block.text.trim() : '';
  if (!text) throw new Error(`Empty completion for finding ${finding.id}`);
  return text;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — did you load your .env file?');
  const anthropic = new Anthropic({ apiKey });

  const ds = buildDataSource();
  await ds.initialize();
  try {
    const repo = ds.getRepository(BugFinding);
    const all = await repo.find({ order: { createdAt: 'ASC' } });
    const pending = all.filter((f) => !f.metadata?.[BACKFILL_METADATA_KEY]);
    const targets = LIMIT ? pending.slice(0, LIMIT) : pending;

    console.log(
      `[backfill] ${all.length} total findings, ${pending.length} missing a plain-language intro, processing ${targets.length}${DRY_RUN ? ' (dry run)' : ''}.`,
    );

    let succeeded = 0;
    let failed = 0;
    for (const finding of targets) {
      try {
        const intro = await generateIntro(anthropic, finding);
        const newDescription = `${intro}\n\n${finding.description}`;
        console.log(
          `\n[backfill] ${finding.id} (${finding.repo || 'no repo'} / ${finding.source}):\n  intro: ${intro}`,
        );
        if (!DRY_RUN) {
          const newMetadata: Record<string, any> = {
            ...(finding.metadata || {}),
            [BACKFILL_METADATA_KEY]: new Date().toISOString(),
          };
          await repo.update(finding.id, {
            description: newDescription,
            metadata: newMetadata,
          });
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[backfill] FAILED for finding ${finding.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `\n[backfill] done. ${succeeded} succeeded, ${failed} failed${DRY_RUN ? ' (dry run — nothing written)' : ''}.`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
