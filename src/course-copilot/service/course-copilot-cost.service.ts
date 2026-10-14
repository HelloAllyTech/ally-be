import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsage } from 'src/analytics/entity/llm-usage.entity';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { TrackItemType } from 'src/track/type/track.type';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../enum/course-copilot.enum';
import { CourseCopilotJobRepository } from '../repository/course-copilot.repository';
import {
  CourseBlueprint,
  CourseBlueprintEstimate,
  CourseBrief,
} from '../type/course-copilot.type';
import { CourseCopilotBudgetView } from '../type/course-copilot-api.type';
import {
  COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD,
  COURSE_COPILOT_JOB_COST_ESTIMATE_USD,
  COURSE_COPILOT_PLANNER_COST_USD,
} from '../constants/course-copilot.constants';

/** The usage labels a session's calls are recorded under. */
const SESSION_TASKS = [
  ...Object.values(LlmTask).filter((task) =>
    String(task).startsWith('course_copilot_'),
  ),
  // The roleplay chain runs on the Agent Builder rows, tagged with the session.
  LlmTask.AUTOFILL_AGENT_FIELD,
];

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Estimates before approval, spend during and after.
 *
 * Estimates are static per-job figures (constants) that err high — approval is
 * refused when they exceed what is left, and a refusal that a few cents of
 * pessimism causes is cheap next to a build that stops half-way. Spend is
 * computed on read from `llm_usage` rows tagged with the session id, priced by
 * the same table the analytics screens use; images have no pricing row by
 * design and count at a flat rate.
 */
@Injectable()
export class CourseCopilotCostService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: AppConfigService,
    private readonly jobRepository: CourseCopilotJobRepository,
  ) {}

  estimate(
    blueprint: Pick<CourseBlueprint, 'sections' | 'cover'>,
    brief: CourseBrief,
  ): CourseBlueprintEstimate {
    const imageCost = this.configService.courseCopilot.imageCostUsd;
    let usd =
      COURSE_COPILOT_PLANNER_COST_USD +
      COURSE_COPILOT_JOB_COST_ESTIMATE_USD[CourseCopilotJobKind.COURSE_META] +
      COURSE_COPILOT_JOB_COST_ESTIMATE_USD[CourseCopilotJobKind.COURSE_REVIEW];
    let minutes = 0;
    let items = 0;
    let newRoleplays = 0;
    let images = blueprint.cover?.mode === 'generate' ? 1 : 0;
    const articleImages = brief.look?.articleImages === 'one-per-article';

    for (const section of blueprint.sections ?? []) {
      for (const item of section.items ?? []) {
        items += 1;
        minutes += Number(item.estimatedMinutes) || 0;
        const isNew = item.source?.kind !== 'library';
        switch (item.type) {
          case TrackItemType.ARTICLE:
            usd += COURSE_COPILOT_JOB_COST_ESTIMATE_USD.article;
            if (articleImages || item.spec?.withImage) images += 1;
            break;
          case TrackItemType.QUIZ:
            usd += COURSE_COPILOT_JOB_COST_ESTIMATE_USD.quiz;
            break;
          case TrackItemType.JOURNAL:
            usd += COURSE_COPILOT_JOB_COST_ESTIMATE_USD.journal;
            break;
          case TrackItemType.ANNOTATED_ARTIFACT:
            usd += COURSE_COPILOT_JOB_COST_ESTIMATE_USD.annotated_artifact;
            break;
          case TrackItemType.ROLEPLAY:
            if (isNew) {
              newRoleplays += 1;
              const languages = Math.max(
                1,
                (item.spec?.languageIds as string[] | undefined)?.length ??
                  brief.shape?.languageIds?.length ??
                  1,
              );
              usd +=
                COURSE_COPILOT_JOB_COST_ESTIMATE_USD.roleplay_new +
                (languages - 1) * COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD;
            }
            break;
          default:
            break;
        }
      }
    }
    usd += images * imageCost;
    return { usd: round2(usd), minutes, items, newRoleplays, images };
  }

  /** What one more job is expected to cost — for the mid-build hold check. */
  jobEstimate(kind: CourseCopilotJobKind, languages = 1): number {
    const base = COURSE_COPILOT_JOB_COST_ESTIMATE_USD[kind] ?? 0;
    if (kind === CourseCopilotJobKind.ROLEPLAY_NEW) {
      return (
        base +
        Math.max(0, languages - 1) * COURSE_COPILOT_EXTRA_LANGUAGE_COST_USD
      );
    }
    return base;
  }

  /** Actual spend so far, USD. */
  async spent(
    session: Pick<CourseCopilotSession, 'id' | 'createdAt'>,
  ): Promise<number> {
    const rows: {
      model: string;
      task: string;
      unit: string;
      prompt: string;
      completion: string;
      cached: string;
      cacheCreation: string;
      calls: string;
    }[] = await this.dataSource
      .getRepository(LlmUsage)
      .createQueryBuilder('lu')
      .select('lu.model', 'model')
      .addSelect('lu.task', 'task')
      .addSelect('lu.unit', 'unit')
      .addSelect('COALESCE(SUM(lu."promptTokens"), 0)', 'prompt')
      .addSelect('COALESCE(SUM(lu."completionTokens"), 0)', 'completion')
      .addSelect('COALESCE(SUM(lu."cachedTokens"), 0)', 'cached')
      .addSelect('COALESCE(SUM(lu."cacheCreationTokens"), 0)', 'cacheCreation')
      .addSelect('COUNT(*)', 'calls')
      .where('lu.task IN (:...tasks)', { tasks: SESSION_TASKS })
      .andWhere('lu."occurredAt" >= :since', {
        // A minute of slack for clock skew between this process and the writer.
        since: new Date(new Date(session.createdAt).getTime() - 60_000),
      })
      .andWhere(`lu.metadata ->> 'courseCopilotSessionId' = :sessionId`, {
        sessionId: session.id,
      })
      .groupBy('lu.model')
      .addGroupBy('lu.task')
      .addGroupBy('lu.unit')
      .getRawMany();

    const imageCost = this.configService.courseCopilot.imageCostUsd;
    let usd = 0;
    for (const row of rows) {
      if (row.task === LlmTask.COURSE_COPILOT_IMAGE || row.unit === 'images') {
        usd += Number(row.calls) * imageCost;
        continue;
      }
      // Whether prompt tokens already include cached reads differs by provider
      // (OpenAI yes, Anthropic no). Pricing both in full can only overstate,
      // and a ceiling that errs high is the safe direction.
      const { costUsd } = computeCostUsd(
        row.model,
        Number(row.prompt) || 0,
        Number(row.completion) || 0,
        {
          cacheReadTokens: Number(row.cached) || 0,
          cacheCreationTokens: Number(row.cacheCreation) || 0,
        },
      );
      usd += costUsd;
    }
    return round2(usd);
  }

  async budget(
    session: CourseCopilotSession,
  ): Promise<CourseCopilotBudgetView> {
    const ceiling = Number(session.budgetUsd) || 0;
    const [spentUsd, held] = await Promise.all([
      this.spent(session),
      this.jobRepository
        .countByStatus(session.id, [CourseCopilotJobStatus.HELD])
        .then((count) => count > 0),
    ]);
    return {
      ceilingUsd: ceiling,
      spentUsd,
      remainingUsd:
        ceiling > 0 ? round2(Math.max(0, ceiling - spentUsd)) : null,
      held,
    };
  }
}
