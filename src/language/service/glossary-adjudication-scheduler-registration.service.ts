import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { GLOSSARY_CONSOLIDATION_DIMENSIONS } from '../constants/glossary.constants';
import { GlossaryAdjudicationService } from './glossary-adjudication.service';
import { LanguageGlossaryService } from './language-glossary.service';

/**
 * Runs adjudication unattended, because otherwise the queue does not move.
 *
 * `propose` mode assumed a reviewer who reads Tamil, Kannada, Hindi and
 * Marathi. There is none, so proposals accumulated: 51 of them by the time
 * anyone looked, of which 20 were wrong in ways nobody had noticed — Tamil
 * grammar rules filed under English among them. Leaving the queue unread is
 * not the safe option it looks like.
 *
 * Mode comes from GLOSSARY_ADJUDICATION_SCHEDULE, mirroring the consolidation
 * flag so both halves of the loop are governed the same way:
 *   - 'off'     (default): no-op. A deploy changes nothing until the flag is
 *               set deliberately.
 *   - 'preview' : decide and LOG the verdicts, apply nothing. The way to watch
 *               it work on real data before letting it write.
 *   - 'apply'   : verdicts are applied.
 *
 * Hourly, not every 30 minutes: consolidation now proposes at most once a day
 * per language, so a faster adjudication tick would only re-scan an unchanged
 * queue. It is also cheap when idle — a language with an empty queue costs one
 * indexed read and no model call.
 */
@Injectable()
export class GlossaryAdjudicationSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GlossaryAdjudicationSchedulerRegistrationService.name,
  );

  constructor(
    private readonly adjudicationService: GlossaryAdjudicationService,
    private readonly glossaryService: LanguageGlossaryService,
  ) {}

  private mode(): 'off' | 'preview' | 'apply' {
    const raw = (process.env.GLOSSARY_ADJUDICATION_SCHEDULE ?? 'off')
      .trim()
      .toLowerCase();
    return raw === 'apply' ? 'apply' : raw === 'preview' ? 'preview' : 'off';
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      'hourly',
      'glossary-adjudication',
      async () => {
        const mode = this.mode();
        if (mode === 'off') return;
        await this.tick(mode);
      },
    );
  }

  /** Exposed for tests; one pass over every candidate language. */
  async tick(mode: 'preview' | 'apply'): Promise<void> {
    const rows: { id: number }[] =
      await this.glossaryService.queryCandidateLanguages([
        ...GLOSSARY_CONSOLIDATION_DIMENSIONS,
      ]);
    for (const { id } of rows) {
      try {
        const result = await this.adjudicationService.adjudicateLanguage(id, {
          apply: mode === 'apply',
          adjudicatedBy: 'scheduler',
        });
        if (result.considered === 0) continue;
        this.logger.info(
          `glossary-adjudication language=${id} mode=${mode} ` +
            `considered=${result.considered} accepted=${result.accepted} ` +
            `rejected=${result.rejected} deferred=${result.deferred}`,
        );
        // Reasons are logged individually: an unattended pass is only
        // trustworthy if a wrong verdict can be found afterwards.
        for (const p of result.proposals) {
          this.logger.debug(
            `glossary-adjudication language=${id} ${p.sectionCode}/${p.entryId} ` +
              `-> ${p.verdict}: ${p.reason}`,
          );
        }
      } catch (error) {
        // Per-language isolation: one failing language never starves the rest.
        this.logger.error(
          `glossary-adjudication failed for language=${id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
