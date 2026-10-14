import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { applyJsonPatch, JsonPatchOp } from 'src/common/util/json-patch.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackService } from 'src/track/service/track.service';
import { TrackStatus } from 'src/track/type/track.type';
import { TRACK_MAX_COMPETENCIES } from 'src/track/constants/track.constant';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotSessionStatus } from '../enum/course-copilot.enum';
import { CourseCopilotSessionRepository } from '../repository/course-copilot.repository';
import { CourseBlueprint } from '../type/course-copilot.type';
import { CourseCopilotBlueprintResponse } from '../type/course-copilot-api.type';
import {
  blueprintWarnings,
  courseCopilotGameOptions,
  normaliseBlueprint,
  validateBlueprint,
} from '../util/course-blueprint.util';
import { BlueprintPlannerSpecialist } from './specialists/blueprint-planner.specialist';
import { CourseCopilotBriefService } from './course-copilot-brief.service';
import { CourseCopilotCostService } from './course-copilot-cost.service';
import { CourseCopilotLibraryService } from './course-copilot-library.service';
import { CourseCopilotStructureService } from './course-copilot-structure.service';

/**
 * The blueprint: the plan the trainer approves before anything is generated.
 *
 * The planner runs once, as a one-shot specialist — not as a second managing
 * agent (Stacks: "Hierarchical Agent Managers Double Costs Without Quality
 * Gains"). Every change after that — a chat edit through `update_blueprint`,
 * an inline edit in the tree — goes through the same normalise → estimate →
 * validate path, so the tree, the estimate and the approve button can never
 * disagree about what is being approved.
 */
@Injectable()
export class CourseCopilotBlueprintService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotBlueprintService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly planner: BlueprintPlannerSpecialist,
    private readonly briefService: CourseCopilotBriefService,
    private readonly costService: CourseCopilotCostService,
    private readonly library: CourseCopilotLibraryService,
    private readonly structureService: CourseCopilotStructureService,
    private readonly trackService: TrackService,
  ) {}

  /** Run the planner and store blueprint v(n+1). Caller has checked readiness. */
  async propose(
    session: CourseCopilotSession,
    notes?: string,
  ): Promise<CourseCopilotBlueprintResponse> {
    const libraryPicks = await this.libraryPicks(session);
    const planned = await this.planner.plan(
      {
        sessionId: session.id,
        brief: session.brief ?? {},
        notes,
        libraryPicks,
        games: courseCopilotGameOptions(),
        usageMetadata: { courseCopilotSessionId: session.id },
      },
      { maxNewRoleplays: this.configService.courseCopilot.maxNewRoleplays },
    );
    return this.store(session, planned, {
      status: CourseCopilotSessionStatus.AWAITING_BLUEPRINT,
    });
  }

  /** `update_blueprint` from chat: JSON patch over the current blueprint. */
  async applyPatch(
    session: CourseCopilotSession,
    ops: JsonPatchOp[],
  ): Promise<CourseCopilotBlueprintResponse> {
    if (!session.blueprint) {
      throw new BadRequestException(
        'There is no blueprint yet — call propose_blueprint first.',
      );
    }
    this.assertEditable(session);
    const patched = applyJsonPatch<CourseBlueprint>(session.blueprint, ops);
    return this.store(session, patched);
  }

  /** `PUT blueprint` from the tree: a whole blueprint, version-checked. */
  async replace(
    session: CourseCopilotSession,
    blueprint: CourseBlueprint,
    version: number,
  ): Promise<CourseCopilotBlueprintResponse> {
    this.assertEditable(session);
    if (Number(version) !== session.blueprintVersion) {
      throw new ConflictException(
        'The blueprint changed while you were editing it (probably from the chat). ' +
          'Your view has been refreshed — make the edit again.',
      );
    }
    return this.store(session, blueprint);
  }

  /** Normalise, estimate, check and present — without storing. */
  async evaluate(
    session: CourseCopilotSession,
    raw: unknown,
  ): Promise<{
    blueprint: CourseBlueprint;
    problems: string[];
    warnings: string[];
  }> {
    const brief = session.brief ?? {};
    const blueprint = normaliseBlueprint(raw, brief);
    blueprint.estimate = this.costService.estimate(blueprint, brief);
    const problems = validateBlueprint(blueprint, brief, {
      maxNewRoleplays: this.configService.courseCopilot.maxNewRoleplays,
    });
    // Library picks must still be live: a roleplay archived since the
    // interview cannot be referenced by a course.
    problems.push(...(await this.staleLibraryProblems(blueprint)));
    return {
      blueprint,
      problems,
      warnings: blueprintWarnings(blueprint, brief),
    };
  }

  async response(
    session: CourseCopilotSession,
  ): Promise<CourseCopilotBlueprintResponse | null> {
    if (!session.blueprint) return null;
    const { blueprint, problems } = await this.evaluate(
      session,
      session.blueprint,
    );
    return {
      blueprint,
      version: session.blueprintVersion,
      estimate: blueprint.estimate,
      budget: await this.costService.budget(session),
      problems,
    };
  }

  /**
   * Freeze the blueprint and create the DRAFT course. Returns the session with
   * `trackId` bound; the caller queues the jobs and starts the build.
   */
  async approve(
    session: CourseCopilotSession,
    version: number,
    userId: number,
  ): Promise<CourseCopilotSession> {
    if (session.status !== CourseCopilotSessionStatus.AWAITING_BLUEPRINT) {
      throw new ConflictException(
        'This blueprint has already been approved or is not ready yet.',
      );
    }
    if (!session.blueprint) {
      throw new BadRequestException('There is no blueprint to approve.');
    }
    if (Number(version) !== session.blueprintVersion) {
      throw new ConflictException(
        'The blueprint changed since you last saw it. Review the latest version, then approve.',
      );
    }
    const { blueprint, problems } = await this.evaluate(
      session,
      session.blueprint,
    );
    if (problems.length) {
      throw new BadRequestException(
        `Fix these before building: ${problems.join(' · ')}`,
      );
    }
    const budget = await this.costService.budget(session);
    if (
      budget.remainingUsd !== null &&
      blueprint.estimate.usd > budget.remainingUsd
    ) {
      throw new BadRequestException(
        `This blueprint is estimated at $${blueprint.estimate.usd.toFixed(2)} but ` +
          `only $${budget.remainingUsd.toFixed(2)} of the session budget is left. ` +
          'Raise the budget or make the course smaller.',
      );
    }

    const brief = session.brief ?? {};
    const competencyIds = [
      ...new Set([
        ...(blueprint.competencyIds ?? []),
        ...(brief.competencyIds ?? []),
      ]),
    ].slice(0, TRACK_MAX_COMPETENCIES);
    const coverImageUrl =
      blueprint.cover?.mode === 'library'
        ? (blueprint.cover.imageUrl ?? brief.look?.coverImageUrl)
        : undefined;

    // Claim the transition first: a double-clicked Approve must create one
    // course, not two.
    const claimed = await this.sessionRepository.manager
      .query(
        `UPDATE "course_copilot_sessions" SET "status" = 'BUILDING', "updatedAt" = now()
          WHERE id = $1 AND "status" = 'AWAITING_BLUEPRINT' AND "blueprintVersion" = $2
          RETURNING id`,
        [session.id, session.blueprintVersion],
      )
      .then((result: any) => (Array.isArray(result?.[0]) ? result[0] : result));
    if (!claimed?.length) {
      throw new ConflictException('This blueprint is already being built.');
    }

    let track: { id: string };
    try {
      track = await this.structureService.asOwner(session, () =>
        this.trackService.createTrack({
          title: blueprint.title.slice(0, 200),
          description: blueprint.description,
          status: TrackStatus.DRAFT,
          estimatedDurationMinutes: blueprint.estimatedDurationMinutes,
          ...(competencyIds.length ? { competencyIds } : {}),
          ...(coverImageUrl ? { coverImageUrl } : {}),
        } as any),
      );
    } catch (error) {
      await this.sessionRepository.update(
        { id: session.id },
        { status: CourseCopilotSessionStatus.AWAITING_BLUEPRINT },
      );
      throw error;
    }

    await this.sessionRepository.update(
      { id: session.id },
      {
        trackId: track.id,
        title: blueprint.title.slice(0, 200),
        approvedBlueprint: blueprint as any,
        status: CourseCopilotSessionStatus.BUILDING,
        updatedBy: userId,
      },
    );
    this.logger.info(
      `Course Copilot ${session.id}: blueprint v${session.blueprintVersion} approved → track ${track.id}`,
    );
    return (await this.sessionRepository.findOne({
      where: { id: session.id },
    }))!;
  }

  private async store(
    session: CourseCopilotSession,
    raw: unknown,
    extra: { status?: CourseCopilotSessionStatus } = {},
  ): Promise<CourseCopilotBlueprintResponse> {
    const { blueprint, problems } = await this.evaluate(session, raw);
    const rows: { blueprintVersion: number }[] =
      await this.sessionRepository.manager
        .query(
          `UPDATE "course_copilot_sessions"
            SET "blueprint" = $2::jsonb,
                "blueprintVersion" = "blueprintVersion" + 1,
                "title" = $3,
                "status" = COALESCE($4, "status"),
                "updatedAt" = now()
          WHERE id = $1
          RETURNING "blueprintVersion"`,
          [
            session.id,
            JSON.stringify(blueprint),
            blueprint.title?.slice(0, 200) || session.title,
            extra.status ?? null,
          ],
        )
        .then((result: any) =>
          Array.isArray(result?.[0]) ? result[0] : result,
        );
    const version = Number(
      rows?.[0]?.blueprintVersion ?? session.blueprintVersion + 1,
    );
    session.blueprint = blueprint;
    session.blueprintVersion = version;
    if (extra.status) session.status = extra.status;
    return {
      blueprint,
      version,
      estimate: blueprint.estimate,
      budget: await this.costService.budget(session),
      problems,
    };
  }

  private assertEditable(session: CourseCopilotSession): void {
    if (
      session.status !== CourseCopilotSessionStatus.AWAITING_BLUEPRINT &&
      session.status !== CourseCopilotSessionStatus.INTERVIEWING
    ) {
      throw new ConflictException(
        'The blueprint is frozen once the build starts. Change the course itself instead.',
      );
    }
  }

  private async libraryPicks(session: CourseCopilotSession) {
    const slots = session.brief?.practice ?? [];
    const scenarioIds = slots
      .filter((slot) => slot.source === 'library' && slot.scenarioId)
      .map((slot) => slot.scenarioId!) as number[];
    const scenarios = await this.library.getActiveScenarios(scenarioIds);
    const names = await this.library.competencyNames(
      scenarios.map((s) => s.competencyId ?? '').filter(Boolean),
    );
    const picks: {
      scenarioId?: number;
      caseId?: string;
      title: string;
      competency?: string | null;
      difficulty?: string | null;
    }[] = scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      title: scenario.title ?? `Roleplay ${scenario.id}`,
      competency: scenario.competencyId
        ? (names.get(scenario.competencyId) ?? null)
        : null,
      difficulty: (scenario as any).difficultyLevel ?? null,
    }));
    for (const slot of slots) {
      if (slot.source !== 'library' || !slot.caseId) continue;
      const caseRow = await this.library.getActiveCase(slot.caseId);
      if (caseRow) picks.push({ caseId: caseRow.id, title: caseRow.title });
    }
    return picks;
  }

  private async staleLibraryProblems(
    blueprint: CourseBlueprint,
  ): Promise<string[]> {
    const problems: string[] = [];
    const refs = blueprint.sections.flatMap((section, sectionIndex) =>
      section.items
        .filter((item) => item.source?.kind === 'library')
        .map((item) => ({ item, sectionIndex })),
    );
    const scenarioIds = refs
      .map(({ item }) => (item.source as any).scenarioId)
      .filter(Boolean) as number[];
    const active = new Set(
      (await this.library.getActiveScenarios(scenarioIds)).map((s) => s.id),
    );
    for (const { item, sectionIndex } of refs) {
      const source = item.source as { scenarioId?: number; caseId?: string };
      if (source.scenarioId && !active.has(source.scenarioId)) {
        problems.push(
          `Section ${sectionIndex + 1} · "${item.title}" uses a roleplay that is no longer published — pick another or make a new one.`,
        );
      }
      if (source.caseId && !(await this.library.getActiveCase(source.caseId))) {
        problems.push(
          `Section ${sectionIndex + 1} · "${item.title}" uses a case that is no longer published.`,
        );
      }
    }
    return problems;
  }
}
