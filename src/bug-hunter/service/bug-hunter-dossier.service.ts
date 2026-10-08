import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import { FixDossier, clipDossierText } from '../constants/bug-fix-dossier';
import { BugFindingVerdict } from '../type/bug-finding-verdict.type';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntLookupKind } from '../enum/bug-hunt-telemetry.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  DOSSIER_MAX_EVENTS_PER_SESSION,
  DOSSIER_MAX_SESSIONS,
  groupSessions,
} from '../util/bug-case-sessions.util';
import { BugCaseFileService } from './bug-case-file.service';
import { BugHunterTelemetryService } from './bug-hunter-telemetry.service';

export { DOSSIER_MAX_EVENTS_PER_SESSION, DOSSIER_MAX_SESSIONS, groupSessions };

export const DOSSIER_SIMILAR_LIMIT = 3;
export const DOSSIER_NEIGHBOUR_LIMIT = 5;
export const DOSSIER_NOTEBOOK_LIMIT = 3;

/**
 * Assembles the fix dossier — everything the platform already knows about a
 * bug — for the session about to fix it. See `FixDossier` for why.
 *
 * Every lookup is best-effort: a dossier that is missing its notebook hits
 * because ally-ai was down is still worth handing over, and a fix session
 * must never fail to start because a side-lookup did. Only the finding
 * itself is required.
 */
@Injectable()
export class BugHunterDossierService {
  private readonly logger = LoggerService.getInstance(
    BugHunterDossierService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly caseFileService: BugCaseFileService,
    private readonly memoryService: AgentMemoryService,
    private readonly telemetryService: BugHunterTelemetryService,
  ) {}

  async build(
    finding: BugFinding,
    repo: string,
    runId?: string,
  ): Promise<FixDossier> {
    const metadata = finding.metadata ?? {};

    // The case file is the shared half of the dossier (OPP-0775): sessions,
    // verdicts, lineage and post-mortem come from it, so the drawer, the
    // Verifier and the fix session all read one record of the same facts.
    const [caseFile, regressionOf, similar, neighbours, notebook] =
      await Promise.all([
        this.caseFileService.build(finding, { currentRunId: runId }),
        this.safely('regression', () =>
          typeof metadata.regressionOf === 'string'
            ? this.findingRepository.findOne({
                where: { id: metadata.regressionOf },
              })
            : Promise.resolve(null),
        ),
        this.safely('similar', () =>
          this.findingRepository.listShippedSimilar(
            repo,
            finding.file,
            finding.symbol,
            finding.id,
            DOSSIER_SIMILAR_LIMIT,
          ),
        ),
        this.safely('neighbours', () =>
          finding.file
            ? this.findingRepository.listOpenInFile(
                repo,
                finding.file,
                finding.id,
                DOSSIER_NEIGHBOUR_LIMIT,
              )
            : Promise.resolve([]),
        ),
        this.safely('notebook', () =>
          this.telemetryService.timed(
            runId,
            BugHuntLookupKind.MEMORY,
            () =>
              this.memoryService.search({
                agent: AgentMemoryAgent.BUG_HUNTER,
                query: clipDossierText(
                  `${finding.title}. ${finding.description}`,
                  600,
                ),
                repo,
                limit: DOSSIER_NOTEBOOK_LIMIT,
              }),
            (hits) => ({
              itemCount: hits.length,
              chars: hits.reduce((sum, h) => sum + h.body.length, 0),
            }),
            { source: 'fix_dossier' },
          ),
        ),
      ]);

    // The sweep's own verifiers (votes) and the independent Verifier are
    // kept apart: the first is a judgement on the reading, the second comes
    // with a reproduction the Fixer starts from (OPP-0784).
    const votes = caseFile.verdicts.filter(
      (v) => v.kind === 'finding' && v.verdict !== 'unavailable' && !v.by,
    );
    const findingVerdicts = Array.isArray(metadata.findingVerdicts)
      ? (metadata.findingVerdicts as BugFindingVerdict[])
      : [];
    const lastIndependent = findingVerdicts[findingVerdicts.length - 1];
    const independent: FixDossier['independent'] = lastIndependent
      ? {
          verdict: lastIndependent.verdict,
          reproduction: lastIndependent.reproduction ?? null,
          refutation: lastIndependent.refutation ?? null,
          wouldBeWrongIf: lastIndependent.wouldBeWrongIf ?? null,
          by: lastIndependent.by?.engine
            ? `${lastIndependent.by.engine}${lastIndependent.by.model ? ` (${lastIndependent.by.model})` : ''}`
            : null,
          at: lastIndependent.at ? new Date(lastIndependent.at) : null,
        }
      : null;
    const confidence =
      typeof metadata.confidence === 'number' ? metadata.confidence : null;

    return {
      finding: {
        id: finding.id,
        title: finding.title,
        description: finding.description,
        originalDescription: finding.originalDescription ?? null,
        file: finding.file ?? null,
        symbol: finding.symbol ?? null,
        source: finding.source,
        severity: finding.severity ?? null,
        proven: finding.proven,
        evidence: finding.evidence ?? null,
        touchesGuardedPath: finding.touchesGuardedPath,
        status: finding.status,
        createdAt: finding.createdAt,
      },
      reporter: caseFile.reporter,
      independent,
      verification:
        confidence != null || votes.length
          ? {
              confidence,
              votes: votes.map((v) => ({
                refuted: v.verdict === 'refuted',
                certainty: v.confidence,
                reason: v.reason,
              })),
            }
          : null,
      lineage: {
        regressionOf: regressionOf
          ? {
              id: regressionOf.id,
              title: regressionOf.title,
              prUrl: regressionOf.prUrl ?? null,
              status: regressionOf.status,
              releaseTag: regressionOf.releaseTag ?? null,
              shippedAt: regressionOf.releasedAt ?? regressionOf.updatedAt,
            }
          : null,
        rediscoveredCount: caseFile.lineage.rediscoveredCount,
      },
      previousSessions: caseFile.sessions,
      postmortem: caseFile.postmortem,
      similarShipped: (similar ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        file: s.file ?? null,
        prUrl: s.prUrl ?? null,
        shippedAt: s.releasedAt ?? s.updatedAt,
        description: clipDossierText(s.description),
      })),
      openNeighbours: (neighbours ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
      })),
      notebook: (notebook ?? []).map((h) => ({
        body: h.body,
        tags: h.tags ?? [],
        similarity: h.similarity,
      })),
    };
  }

  private async safely<T>(
    what: string,
    fetch: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fetch();
    } catch (error) {
      this.logger.warn(
        `Fix dossier: could not load ${what}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
