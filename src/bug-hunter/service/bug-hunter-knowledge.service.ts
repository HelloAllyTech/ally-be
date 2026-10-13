import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntLookupKind } from '../enum/bug-hunt-telemetry.enum';
import { BugKnowledge } from '../constants/bug-hunter-knowledge';
import { playbooksFor } from '../constants/bug-hunter-playbooks';
import { BugHunterFeatureMapService } from './bug-hunter-feature-map.service';
import { BugHunterPrecedentService } from './bug-hunter-precedent.service';
import { BugHunterTelemetryService } from './bug-hunter-telemetry.service';

/**
 * Assembles what Bug Hunter knows that fits one bug — playbooks, resolved
 * look-alikes, feature cards — for the fix dossier and the Verifier's brief.
 * Each half fails soft: a broken lookup costs that half, never the prompt.
 */
@Injectable()
export class BugHunterKnowledgeService {
  private readonly logger = LoggerService.getInstance(
    BugHunterKnowledgeService.name,
  );

  constructor(
    private readonly precedents: BugHunterPrecedentService,
    private readonly featureMaps: BugHunterFeatureMapService,
    private readonly telemetry: BugHunterTelemetryService,
  ) {}

  async forFinding(
    finding: Pick<BugFinding, 'id' | 'title' | 'description' | 'file'>,
    runId?: string,
  ): Promise<BugKnowledge> {
    const [precedents, featureCards] = await Promise.all([
      this.safely('precedents', () =>
        this.telemetry.timed(
          runId,
          BugHuntLookupKind.PRECEDENTS,
          () => this.precedents.similar(finding),
          (rows) => ({ itemCount: rows.length, chars: 0 }),
          { findingId: finding.id },
        ),
      ),
      this.safely('feature map', () =>
        this.telemetry.timed(
          runId,
          BugHuntLookupKind.FEATURE_MAP,
          () => this.featureMaps.forBug(finding),
          (rows) => ({
            itemCount: rows.length,
            chars: rows.reduce((sum, r) => sum + r.summary.length, 0),
          }),
          { findingId: finding.id },
        ),
      ),
    ]);
    return {
      playbooks: playbooksFor(`${finding.title}\n${finding.description}`),
      precedents,
      featureCards,
    };
  }

  private async safely<T>(
    what: string,
    fetch: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await fetch();
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] knowledge lookup (${what}) failed; the prompt goes without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
