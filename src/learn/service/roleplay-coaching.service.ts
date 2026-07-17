import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { LoggerService } from 'src/logger/logger.service';
import { RoleplayDirectorEvent } from 'src/roleplay-studio/entity/roleplay-director-event.entity';
import { RoleplayRubricScore } from 'src/roleplay-studio/entity/roleplay-rubric-score.entity';
import { RoleplaySpecVersion } from 'src/roleplay-studio/entity/roleplay-spec-version.entity';
import { RoleplayDirectorEventType } from 'src/roleplay-studio/enum/director-event-type.enum';

import { ScenarioEngine } from '../enum/scenario-engine.enum';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import {
  RoleplayCoachingBehaviorDto,
  RoleplayCoachingResponseDto,
} from '../dto/roleplay-coaching-response.dto';

const EMPTY: RoleplayCoachingResponseDto = {
  available: false,
  stateJourney: [],
  strengths: [],
  growthAreas: [],
  disclosures: [],
  coachingNotes: [],
};

/** Max Director rationales kept per behavior as evidence. */
const MAX_EXAMPLES = 3;

interface RubricAgg {
  observedCount: number;
  totalScore: number;
  examples: string[];
}

/**
 * Learner-facing coaching for a Roleplay Studio v2 session. Reuses the v1
 * ownership check (ScenarioSessionRepository scopes by counselorId + tenant),
 * then joins the persisted v2 spec-telemetry (rubric scores, state journey,
 * disclosures, Director coaching) with the spec's rubric labels. Read-only.
 */
@Injectable()
export class RoleplayCoachingService {
  private readonly logger = LoggerService.getInstance(
    RoleplayCoachingService.name,
  );

  constructor(
    private readonly scenarioSessionRepository: ScenarioSessionRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly dataSource: DataSource,
  ) {}

  async getLearnerCoaching(
    scenarioSessionId: string,
    counselorId: number,
  ): Promise<RoleplayCoachingResponseDto> {
    const hasAdminAccess = await this.permissionValidator.validatePermissions(
      counselorId,
      [PERMISSIONS.ORGANIZATION_ACCESS],
    );
    // Ownership + tenant scoping enforced here — returns null when the session
    // isn't the caller's (and they're not an org admin).
    const session = (await this.scenarioSessionRepository.getScenarioSession(
      scenarioSessionId,
      counselorId,
      hasAdminAccess,
    )) as any;

    if (!session) return EMPTY;
    const engine = session.scenario?.engine;
    if (engine !== ScenarioEngine.ROLEPLAY_V2) return EMPTY;

    const [rubricByBehavior, events, behaviorMeta, summary] = await Promise.all(
      [
        this.aggregateRubricScores(scenarioSessionId),
        this.loadEvents(scenarioSessionId),
        this.loadRubricLabels(scenarioSessionId),
        Promise.resolve(session.metadata?.roleplaySummary ?? {}),
      ],
    );

    const strengths: RoleplayCoachingBehaviorDto[] = [];
    const growthAreas: RoleplayCoachingBehaviorDto[] = [];
    for (const meta of behaviorMeta) {
      const agg = rubricByBehavior.get(meta.id);
      const observedCount = agg?.observedCount ?? 0;
      const dto: RoleplayCoachingBehaviorDto = {
        behaviorId: meta.id,
        name: meta.name,
        description: meta.description,
        polarity: meta.polarity,
        observedCount,
        totalScore: agg?.totalScore ?? 0,
        examples: agg?.examples ?? [],
      };
      if (meta.polarity === 'helpful' && observedCount > 0) {
        strengths.push(dto);
      } else if (meta.polarity === 'unhelpful' && observedCount > 0) {
        growthAreas.push(dto);
      } else if (meta.polarity === 'helpful' && observedCount === 0) {
        // A helpful behavior the trainee never demonstrated is a growth area.
        growthAreas.push(dto);
      }
    }

    return {
      available: true,
      finalStateId: summary.finalStateId,
      stateJourney: Array.isArray(summary.statePath) ? summary.statePath : [],
      cumulativeScore:
        typeof summary.cumulativeScore === 'number'
          ? summary.cumulativeScore
          : (session.score ?? undefined),
      strengths,
      growthAreas,
      disclosures: events.disclosures,
      coachingNotes: events.coachingNotes,
    };
  }

  private async aggregateRubricScores(
    scenarioSessionId: string,
  ): Promise<Map<string, RubricAgg>> {
    const rows = await this.dataSource
      .getRepository(RoleplayRubricScore)
      .find({ where: { scenarioSessionId }, order: { turnIndex: 'ASC' } });
    const byBehavior = new Map<string, RubricAgg>();
    for (const row of rows) {
      const agg = byBehavior.get(row.behaviorId) ?? {
        observedCount: 0,
        totalScore: 0,
        examples: [],
      };
      agg.observedCount += 1;
      agg.totalScore += Number(row.score ?? 0);
      if (row.rationale && agg.examples.length < MAX_EXAMPLES) {
        agg.examples.push(row.rationale);
      }
      byBehavior.set(row.behaviorId, agg);
    }
    return byBehavior;
  }

  private async loadEvents(scenarioSessionId: string) {
    const rows = await this.dataSource
      .getRepository(RoleplayDirectorEvent)
      .find({ where: { scenarioSessionId }, order: { turnIndex: 'ASC' } });
    const disclosures = rows
      .filter(
        (r) => r.eventType === RoleplayDirectorEventType.DISCLOSURE_UNLOCK,
      )
      .map((r) => ({
        secretId: String(r.payload?.secret_id ?? ''),
        topic: String(r.payload?.disclosed_content_summary ?? ''),
        turnIndex: r.turnIndex ?? undefined,
      }))
      .filter((d) => d.secretId);
    const coachingNotes = rows
      .filter(
        (r) =>
          r.eventType === RoleplayDirectorEventType.STAGE_DIRECTION &&
          typeof r.payload?.trainee_feedback === 'string' &&
          r.payload.trainee_feedback.trim().length > 0,
      )
      .map((r) => ({
        turnIndex: r.turnIndex ?? undefined,
        feedback: String(r.payload.trainee_feedback),
      }));
    return { disclosures, coachingNotes };
  }

  /**
   * The rubric behavior labels come from the spec VERSION the session ran, so
   * they match the ids the Director scored. `roleplaySpecVersionId` lives only
   * as a DB column on scenario_sessions (not the entity), so read it raw.
   */
  private async loadRubricLabels(scenarioSessionId: string): Promise<
    Array<{
      id: string;
      name: string;
      description?: string;
      polarity: 'helpful' | 'unhelpful';
    }>
  > {
    try {
      const rows: Array<{ roleplaySpecVersionId: string | null }> =
        await this.dataSource.query(
          `SELECT "roleplaySpecVersionId" FROM "scenario_sessions" WHERE id = $1`,
          [scenarioSessionId],
        );
      const versionId = rows?.[0]?.roleplaySpecVersionId;
      if (!versionId) return [];
      const version = await this.dataSource
        .getRepository(RoleplaySpecVersion)
        .findOne({ where: { id: versionId } });
      const behaviors = version?.spec?.rubric?.behaviors ?? [];
      return behaviors.map((b: any) => ({
        id: b.id,
        name: b.name ?? b.id,
        description: b.description,
        polarity: b.polarity === 'unhelpful' ? 'unhelpful' : 'helpful',
      }));
    } catch (error) {
      this.logger.warn(
        `Failed to load rubric labels for session ${scenarioSessionId}: ${error}`,
      );
      return [];
    }
  }
}
