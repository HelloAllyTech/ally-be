import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { GlossaryJobService } from './glossary-job.service';
import {
  GlossaryLexemeMiningService,
  MineLexemesOptions,
  MineLexemesResult,
} from './glossary-lexeme-mining.service';

/**
 * Mines bookish words every week, for every language with a published
 * glossary except English, so new pairs keep flowing without anyone running
 * the job by hand.
 *
 * The rest of the loop is already unattended: the hourly adjudicator decides
 * what this queues, and the runtime swap enforces whatever is published. Team
 * decision 2026-10-01: there is nobody to review each language, so the loop
 * ships and learner feedback decides — a bad pair is undone by rejecting or
 * archiving its rule.
 *
 * Weekly because the input moves slowly (a few dozen judged sessions per
 * language per month) and every run makes up to four gemini-2.5-pro calls.
 * Languages run one after another under the same per-language lock as the
 * manual endpoint, so a run never overlaps a manual one; a language that is
 * busy is skipped until next week.
 *
 * Mode comes from GLOSSARY_LEXEME_MINING_SCHEDULE:
 *   - 'write' (default): queue pairs as proposals.
 *   - 'dry'           : mine and log, write nothing.
 *   - 'off'           : no-op.
 */
@Injectable()
export class GlossaryLexemeMiningSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GlossaryLexemeMiningSchedulerRegistrationService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly miningService: GlossaryLexemeMiningService,
    private readonly jobs: GlossaryJobService,
  ) {}

  private mode(): 'off' | 'dry' | 'write' {
    const raw = (process.env.GLOSSARY_LEXEME_MINING_SCHEDULE ?? 'write')
      .trim()
      .toLowerCase();
    return raw === 'off' ? 'off' : raw === 'dry' ? 'dry' : 'write';
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      'weekly',
      'glossary-lexeme-mining',
      async () => {
        const mode = this.mode();
        if (mode === 'off') return;
        await this.tick(mode);
      },
    );
  }

  /** Languages with a published global glossary section, English excluded. */
  async candidateLanguages(): Promise<{ id: number; value: string }[]> {
    return this.dataSource.query(
      `SELECT DISTINCT l.id, l.value
         FROM language_glossary_sections s
         JOIN languages l ON l.id = s."languageId"
        WHERE s.status = 'published'
          AND s."profileId" IS NULL
          AND l.value NOT ILIKE 'en%'
        ORDER BY l.id`,
    );
  }

  /** Exposed for tests; one pass over every candidate language. */
  async tick(mode: 'dry' | 'write'): Promise<void> {
    const options: MineLexemesOptions = { dryRun: mode === 'dry' };
    for (const { id, value } of await this.candidateLanguages()) {
      try {
        const job = await this.jobs.runExclusive<
          MineLexemesResult,
          MineLexemesOptions
        >('lexeme-mining', id, options, () =>
          this.miningService.mineLexemes(id, options, 'scheduler'),
        );
        if (!job) {
          this.logger.info(
            `glossary-lexeme-mining language=${value} skipped: a run already holds it`,
          );
          continue;
        }
        if (job.status === 'failed') {
          this.logger.error(
            `glossary-lexeme-mining language=${value} failed: ${job.error}`,
          );
          continue;
        }
        const stats = job.result?.stats;
        this.logger.info(
          `glossary-lexeme-mining language=${value} mode=${mode} ` +
            `candidates=${stats?.candidates ?? 0} paired=${stats?.paired ?? 0} ` +
            `written=${stats?.written ?? 0} batch=${job.result?.batchId ?? null}`,
        );
      } catch (error) {
        // Per-language isolation: one failing language never starves the rest.
        this.logger.error(
          `glossary-lexeme-mining failed for language=${value}: ${(error as Error).message}`,
        );
      }
    }
  }
}
