import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LanguageGlossaryService } from './language-glossary.service';
import { GLOSSARY_CONSOLIDATION_DIMENSIONS } from '../constants/glossary.constants';

/**
 * The RSI loop's clock. It rides the shared 30-minute scheduler, but that tick
 * is only how often eligibility is CHECKED — never how often a language
 * consolidates. Two gates decide that:
 *
 *   - interval: the last batch is older than GLOSSARY_CONSOLIDATE_INTERVAL_HOURS
 *     (default 168 — weekly) and at least one unconsumed annotation exists, or
 *   - data threshold: unconsumed non-test style annotations reach
 *     GLOSSARY_CONSOLIDATE_MIN_ANNOTATIONS (default 25) — an early fire for a
 *     language producing errors faster than the weekly cadence would catch.
 *
 * Both are floored by GLOSSARY_CONSOLIDATE_MIN_GAP_HOURS (default 24): no
 * language consolidates more than once a day whatever the triggers say.
 *
 * That floor is the lesson from production. The interval was 24h and the data
 * threshold 25, and once the backlog was unstalled EVERY language sat above 25
 * permanently — so the data trigger fired on every single 30-minute tick,
 * consolidating 197-200 annotations per language 48 times a day. The cadence
 * was nominally daily and actually half-hourly. A weekly interval alone would
 * not have fixed it; the floor is what makes the ceiling real.
 *
 * Weekly is also the right pace for what this produces: glossary rules go into
 * an every-turn prompt with a fixed token budget, a human or the adjudicator
 * has to decide each proposal, and error evidence accumulates over days, not
 * minutes.
 *
 * Mode comes from GLOSSARY_CONSOLIDATION_SCHEDULE:
 *   - 'off'      (default): scheduler is a no-op — deploys change nothing
 *                until the flag is set deliberately.
 *   - 'propose'  : scheduled runs create proposals for review.
 *   - 'auto'     : scheduled runs auto-accept + publish (full RSI mode);
 *                safety = dedupe, Tier 0 cap, batch rollback.
 */
@Injectable()
export class GlossaryConsolidationSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GlossaryConsolidationSchedulerRegistrationService.name,
  );

  constructor(private readonly glossaryService: LanguageGlossaryService) {}

  private mode(): 'off' | 'propose' | 'auto' {
    const raw = (process.env.GLOSSARY_CONSOLIDATION_SCHEDULE ?? 'off')
      .trim()
      .toLowerCase();
    return raw === 'auto' ? 'auto' : raw === 'propose' ? 'propose' : 'off';
  }

  private intervalHours(): number {
    const parsed = parseInt(
      process.env.GLOSSARY_CONSOLIDATE_INTERVAL_HOURS ?? '168',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 168;
  }

  /** Hard floor between runs for one language, whichever trigger fired. */
  private minGapHours(): number {
    const parsed = parseInt(
      process.env.GLOSSARY_CONSOLIDATE_MIN_GAP_HOURS ?? '24',
      10,
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 24;
  }

  private minAnnotations(): number {
    const parsed = parseInt(
      process.env.GLOSSARY_CONSOLIDATE_MIN_ANNOTATIONS ?? '25',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'glossary-consolidation',
      async () => {
        const mode = this.mode();
        if (mode === 'off') return;
        await this.tick(mode);
      },
    );
  }

  /** Exposed for tests; one scheduler pass over every candidate language. */
  async tick(mode: 'propose' | 'auto'): Promise<void> {
    const candidates = await this.candidateLanguageIds();
    for (const languageId of candidates) {
      try {
        const unconsumed =
          await this.glossaryService.countUnconsumedAnnotations(languageId);
        if (unconsumed === 0) continue;

        // The floor comes first: a standing backlog keeps the data trigger
        // permanently true, so without this the 30-minute tick BECOMES the
        // cadence. Checked before the triggers to make that impossible.
        const ageHours = await this.hoursSinceLastBatch(languageId);
        if (ageHours !== null && ageHours < this.minGapHours()) continue;

        const dataTrigger = unconsumed >= this.minAnnotations();
        const intervalTrigger =
          ageHours === null || ageHours >= this.intervalHours();
        if (!dataTrigger && !intervalTrigger) continue;

        const result = await this.glossaryService.consolidateGlossary(
          languageId,
          'scheduler',
          { autoAccept: mode === 'auto', trigger: 'scheduled' },
        );
        this.logger.debug(
          `glossary-consolidation language=${languageId} mode=${mode} ` +
            `trigger=${dataTrigger ? 'data' : 'interval'} ` +
            `proposed=${result.proposed} autoAccepted=${result.autoAccepted} batch=${result.batchId}`,
        );
      } catch (error) {
        // Per-language isolation: one failing language never starves the rest.
        this.logger.error(
          `glossary-consolidation failed for language=${languageId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Languages with recent style-dimension annotations (90d), by id. */
  private async candidateLanguageIds(): Promise<number[]> {
    const rows: { id: number }[] =
      await this.glossaryService.queryCandidateLanguages([
        ...GLOSSARY_CONSOLIDATION_DIMENSIONS,
      ]);
    return rows.map((r) => r.id);
  }

  /**
   * Hours since this language's last batch, or null when it has never run.
   *
   * One read serving both the floor and the interval, so they can never
   * disagree about how old the last batch is.
   */
  private async hoursSinceLastBatch(
    languageId: number,
  ): Promise<number | null> {
    const [latest] =
      await this.glossaryService.listConsolidationBatches(languageId);
    if (!latest) return null;
    return (Date.now() - new Date(latest.createdAt).getTime()) / 3600_000;
  }
}
