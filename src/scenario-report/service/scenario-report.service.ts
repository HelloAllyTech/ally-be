import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, LessThan } from 'typeorm';
import { ScenarioReport } from '../entity/scenario-report.entity';
import { ScenarioReportStatus } from '../enum/scenario-report.enum';
import {
  CreateScenarioReportDto,
  CreateScenarioReportResponseDto,
  ScenarioReportDto,
  ScenarioReportResponseDto,
  UpdateScenarioReportDto,
} from '../dto/scenario-report.dto';
import { ScenarioReportNotificationService } from './scenario-report-notification.service';
import { ScenarioReportRepository } from '../repository/scenario-report.repository';
import { ScenarioReportTranscriptService } from './scenario-report-transcript.service';
import {
  SCENARIO_REPORT_END_STATUSES,
  SCENARIO_REPORT_PENDING_STATUSES,
} from '../constants/scenario-report.constant';
import { AiService } from '../../ai/service/ai.service';
import { SharedLanguageService } from '../../language/service/shared-language.service';
import { LoggerService } from '../../logger/logger.service';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { ScenarioReportTranscriptResponseDto } from '../dto/scenario-report-transcript.dto';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { Languages } from 'src/language/entity/languages.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  SCENARIO_REPORT_REDIS_KEY_PREFIX,
  SCENARIO_REPORT_TIMEOUT_MINUTES,
  SCENARIO_REPORT_TTL_SECONDS,
} from '../constants/scenario-report.constant';
import { TIME } from 'src/common/constants/time.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { COPILOT_REPORT_COMPLETED_EVENT } from 'src/copilot/enum/copilot-run.enum';

@Injectable()
export class ScenarioReportService {
  private readonly logger = LoggerService.getInstance(
    ScenarioReportService.name,
  );

  constructor(
    private readonly scenarioReportRepository: ScenarioReportRepository,
    private readonly scenarioReportNotificationService: ScenarioReportNotificationService,
    private readonly scenarioReportTranscriptService: ScenarioReportTranscriptService,
    private readonly aiService: AiService,
    private readonly sharedLanguageService: SharedLanguageService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly openAITranslationsService: OpenAITranslationsService,
    private readonly redisService: RedisService,
    private readonly permissionsService: PermissionsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createScenarioReport(
    scenarioId: number,
    createScenarioReportDto: CreateScenarioReportDto,
    userId: number,
  ): Promise<CreateScenarioReportResponseDto> {
    //Check if the user is generating report for their own scenario if user is multi tenant
    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    if (isMultiTenantAdmin) {
      const scenario =
        await this.scenarioSharedService.getAdminScenario(scenarioId);

      if (!scenario) {
        throw new NotFoundException('Scenario not found');
      }

      if (scenario.createdBy !== userId) {
        throw new ForbiddenException(
          'You are not authorized to generate report for this scenario.',
        );
      }
    }

    //Check if there are any scenario reports in progress for the same scenario
    await this.checkForInProgressScenarioReports(scenarioId);
    //Check if the scenario has all the active mandatory fields
    const scenario =
      await this.scenarioSharedService.getAdminScenario(scenarioId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    if (
      !this.scenarioSharedService.hasAllActiveScenarioMandatoryFields(scenario)
    ) {
      throw new BadRequestException(
        'Required fields are missing for the scenario',
      );
    }

    const languages = await this.sharedLanguageService.getLanguagesByIds([
      createScenarioReportDto.languageId,
    ]);
    if (!languages || languages.length === 0) {
      throw new BadRequestException('Invalid language ID');
    }

    const scenarioReportEntity = this.scenarioReportRepository.create({
      scenarioId,
      config: {
        ...createScenarioReportDto,
        // Snapshot the main-agent variant ("skill") in effect right now so
        // report history records which skill produced this report, even if
        // the scenario later switches variants.
        selectedMainPromptCode: scenario.metadata?.selectedMainPromptCode,
        // Snapshot the transcript-evaluator prompt variant chosen for this run.
        // Prefer the value sent live with the request (lets a freshly picked
        // variant take effect without a scenario save) and fall back to the
        // scenario's saved selection. Undefined means the default evaluator.
        selectedEvaluatorPromptCode:
          createScenarioReportDto.selectedEvaluatorPromptCode ??
          scenario.metadata?.selectedEvaluatorPromptCode,
      },
      createdBy: userId,
      updatedBy: userId,
    });
    const scenarioReport =
      await this.scenarioReportRepository.save(scenarioReportEntity);

    this.scenarioReportNotificationService.notifyUpdate(
      scenarioReport.createdBy,
      scenarioReport.id,
    );

    await this.redisService.set(
      `${SCENARIO_REPORT_REDIS_KEY_PREFIX}:${scenarioReport.id}`,
      scenarioReport.id,
      SCENARIO_REPORT_TTL_SECONDS,
    );

    this.triggerScenarioReportGeneration(scenarioReport, languages[0]?.value);
    return {
      id: scenarioReport.id,
      status: scenarioReport.status,
    };
  }

  async checkForInProgressScenarioReports(
    scenarioId: number,
    errorMessage?: string,
  ): Promise<void> {
    const inProgressScenarioReports = await this.scenarioReportRepository.find({
      where: {
        scenarioId,
        status: ScenarioReportStatus.IN_PROGRESS,
      },
    });
    if (inProgressScenarioReports.length > 0) {
      throw new BadRequestException(
        errorMessage ??
          'There is already a scenario report in progress for this scenario',
      );
    }
  }

  private async triggerScenarioReportGeneration(
    report: ScenarioReport,
    languageCode: string,
  ): Promise<void> {
    try {
      const metadata =
        await this.scenarioSharedService.createMetadataForScenario(
          report.scenarioId,
          report.config.languageId,
        );

      const translatedPrompt =
        await this.openAITranslationsService.translateText(
          report.config.helperAgentPrompt,
          languageCode,
        );

      await this.aiService.triggerScenarioReportGenerate({
        prompt: translatedPrompt,
        turns: report.config.turns,
        language: languageCode,
        scenario_id: report.scenarioId,
        report_id: report.id,
        metadata: metadata,
        evaluator_prompt_code: report.config.selectedEvaluatorPromptCode,
      });

      const currentReport = await this.scenarioReportRepository.findOne({
        where: { id: report.id },
      });
      if (
        currentReport &&
        !SCENARIO_REPORT_END_STATUSES.includes(currentReport.status)
      ) {
        await this.scenarioReportRepository.update(report.id, {
          status: ScenarioReportStatus.IN_PROGRESS,
          updatedBy: report.updatedBy,
        });
      }

      this.scenarioReportNotificationService.notifyUpdate(
        report.createdBy,
        report.id,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Scenario report generation failed for report ${report.id}: ${errorMessage}`,
      );

      await this.scenarioReportRepository.update(report.id, {
        status: ScenarioReportStatus.FAILED,
        metadata: { error: errorMessage } as Record<string, any>,
        updatedBy: report.updatedBy,
      });
      await this.redisService.del(
        `${SCENARIO_REPORT_REDIS_KEY_PREFIX}:${report.id}`,
      );

      this.scenarioReportNotificationService.notifyUpdate(
        report.createdBy,
        report.id,
      );
    }
  }

  async getScenarioReportById(reportId: string): Promise<ScenarioReportDto> {
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const scenarioReport = await this.scenarioReportRepository.findOne({
      where: { id: reportId },
    });
    if (!scenarioReport) {
      throw new NotFoundException('Scenario report not found');
    }

    if (userId) {
      //Check if the user is generating report for their own scenario if user is multi tenant
      const isMultiTenantAdmin =
        await this.permissionsService.isMultiTenantAdmin(userId);

      if (isMultiTenantAdmin) {
        const scenario = await this.scenarioSharedService.getAdminScenario(
          scenarioReport.scenarioId,
        );

        if (!scenario) {
          throw new NotFoundException('Scenario not found');
        }

        if (scenario.createdBy !== userId) {
          throw new ForbiddenException(
            'You are not authorized to view report for this scenario.',
          );
        }
      }
    }
    const [languages, scenario] = await Promise.all([
      this.sharedLanguageService.getLanguagesByIds([
        scenarioReport.config.languageId,
      ]),
      this.scenarioSharedService.getScenarioById(scenarioReport.scenarioId),
    ]);

    return {
      ...scenarioReport,
      scenarioTitle: scenario?.title ?? '',
      language: this.toReportLanguage(languages[0]),
      // Lift the failure reason from metadata to a top-level field for the
      // studio. Persisted under metadata.errorMessage (no migration needed)
      // but the studio shouldn't have to know that.
      errorMessage: (
        scenarioReport.metadata as { errorMessage?: string } | undefined
      )?.errorMessage,
    };
  }

  async getScenarioReports(
    scenarioId: number,
    statuses?: string,
    pagination?: Pagination,
  ): Promise<ScenarioReportResponseDto> {
    const validStatuses = Object.values(ScenarioReportStatus);
    const statusList =
      statuses
        ?.split(',')
        .map((status) => status.trim())
        .filter((status) => status.length > 0) ?? [];
    const invalidStatuses = statusList.filter(
      (s) => !validStatuses.includes(s as ScenarioReportStatus),
    );
    if (invalidStatuses.length > 0) {
      throw new BadRequestException(
        `Invalid status values: ${invalidStatuses.join(', ')}. Valid values are: ${validStatuses.join(', ')}`,
      );
    }
    const [scenarioReports, count] =
      await this.scenarioReportRepository.getAllScenarioReportsAndCount(
        scenarioId,
        statusList,
        pagination,
      );

    const [languagesMap, scenario] = await Promise.all([
      this.getLanguagesMap(
        scenarioReports.map((report) => report.config.languageId),
      ),
      this.scenarioSharedService.getScenarioById(scenarioId),
    ]);

    return {
      data: scenarioReports.map((report) => ({
        ...report,
        scenarioTitle: scenario?.title ?? '',
        language: this.toReportLanguage(languagesMap[report.config.languageId]),
      })),
      count,
    };
  }

  private async getLanguagesMap(
    languageIds: number[],
  ): Promise<Record<number, Languages>> {
    const languages = await this.sharedLanguageService.getLanguagesByIds([
      ...new Set(languageIds),
    ]);
    return languages.reduce<Record<number, Languages>>((acc, language) => {
      acc[language.id] = language;
      return acc;
    }, {});
  }

  async cancelScenarioReport(
    reportId: string,
    userId: number,
  ): Promise<SuccessResponse> {
    const report = await this.getScenarioReportById(reportId);
    if (report.createdBy !== userId) {
      throw new ForbiddenException(
        'You are not allowed to cancel this scenario report',
      );
    }
    if (SCENARIO_REPORT_END_STATUSES.includes(report.status)) {
      throw new BadRequestException(
        'Cannot cancel a scenario report that is already completed, cancelled, or failed',
      );
    }

    await this.scenarioReportRepository.update(reportId, {
      status: ScenarioReportStatus.CANCELLED,
      updatedBy: userId,
      endedAt: new Date(),
    });
    await this.redisService.del(
      `${SCENARIO_REPORT_REDIS_KEY_PREFIX}:${reportId}`,
    );

    // Propagate cancel to ai-learn so the N-turn loop stops + the
    // evaluator is skipped. Without this, the asyncio task in ai-learn
    // kept running for 3+ minutes after the user clicked Cancel, burning
    // LLM tokens that nobody would ever see (every per-turn webhook hit
    // the end-status guard in updateScenarioReport / appendLiveTranscript
    // and was silently dropped). Fire-and-forget at the service level:
    // ai-learn's response doesn't gate the user's response to the cancel
    // mutation, but we await it to surface errors in the request log.
    await this.aiService.triggerScenarioReportCancel(reportId);

    this.scenarioReportNotificationService.notifyUpdate(
      report.createdBy,
      reportId,
    );
    return {
      success: true,
    };
  }

  async getFilteredScenarioReports(
    createdBy: number,
    lookbackMinutes?: number,
  ): Promise<ScenarioReportResponseDto> {
    const reports =
      await this.scenarioReportRepository.findRecentReportsByCreatedBy(
        createdBy,
        lookbackMinutes,
      );

    const scenarioIds = [
      ...new Set(reports.map((report) => report.scenarioId)),
    ];
    const [languagesMap, scenarios] = await Promise.all([
      this.getLanguagesMap(reports.map((report) => report.config.languageId)),
      this.scenarioSharedService.getScenarioByIds(scenarioIds),
    ]);

    const scenariosMap = scenarios.reduce<Record<number, Scenarios>>(
      (acc, scenario) => {
        acc[scenario.id] = scenario;
        return acc;
      },
      {},
    );

    return {
      data: reports.map((report) => ({
        ...report,
        scenarioTitle: scenariosMap[report.scenarioId]?.title ?? '',
        language: this.toReportLanguage(languagesMap[report.config.languageId]),
      })),
      count: reports.length,
    };
  }

  private toReportLanguage(
    lang: Languages | undefined,
  ): { id: number; value: string; label: string } | undefined {
    if (!lang) return undefined;
    return { id: lang.id, value: lang.value, label: lang.label };
  }

  async updateScenarioReport(
    reportId: string,
    dto: UpdateScenarioReportDto,
  ): Promise<ScenarioReportDto> {
    this.logger.info(
      `Recieved webhook update for scenario report ${reportId} with status: ${dto.status}`,
    );

    const report = await this.getScenarioReportById(reportId);

    // Status flips are one-way: once the report reaches an end status
    // (COMPLETED / FAILED / CANCELLED) we never let a late webhook
    // overwrite it. But we *do* still accept supplementary data —
    // transcripts, metrics, markdown, error message — because:
    //   - If user cancelled mid-run, ai-learn keeps producing turns
    //     until cancel propagation lands; those partial transcripts are
    //     worth showing.
    //   - If ai-learn evaluated successfully but the row was already
    //     CANCELLED, the metrics are still informative to record.
    // The guard below splits "what is locked" from "what is additive"
    // instead of dropping the whole update on the floor.
    const statusLocked = SCENARIO_REPORT_END_STATUSES.includes(report.status);
    if (statusLocked) {
      this.logger.info(
        `Report ${reportId} already in end status (${report.status}); ` +
          `accepting additive transcript/metrics/markdown but ignoring status flip`,
      );
    }

    {
      const updatePayload: Partial<ScenarioReport> = {};
      if (dto.metrics !== undefined) updatePayload.metrics = dto.metrics;
      if (dto.report_markdown !== undefined)
        updatePayload.reportMarkdown = dto.report_markdown;
      if (dto.status !== undefined && !statusLocked) {
        updatePayload.status = dto.status;
        if (SCENARIO_REPORT_END_STATUSES.includes(dto.status)) {
          updatePayload.endedAt = new Date();
        }
      }

      // Persist failure reason from ai-learn into metadata.errorMessage.
      // Using the existing JSONB column avoids a schema migration; the GET
      // response builder mirrors it onto a top-level `errorMessage` field
      // so the studio doesn't have to dig into metadata. Only written when
      // ai-learn actually supplied a non-empty reason — preserves any
      // unrelated metadata keys that were set earlier in the report's life.
      if (dto.error_message) {
        updatePayload.metadata = {
          ...(report.metadata ?? {}),
          errorMessage: dto.error_message,
        };
      }

      if (Object.keys(updatePayload).length > 0) {
        await this.scenarioReportRepository.update(reportId, updatePayload);
        if (
          updatePayload.status !== undefined &&
          SCENARIO_REPORT_END_STATUSES.includes(updatePayload.status)
        ) {
          await this.redisService.del(
            `${SCENARIO_REPORT_REDIS_KEY_PREFIX}:${reportId}`,
          );

          // Resume seam for the Copilot orchestrator: when a report reaches a
          // terminal status, signal any Copilot run whose current round is
          // bound to this report so it can score the round and continue/stop.
          // Fired for every terminal report; the Copilot listener is a no-op
          // for reports that don't belong to a run (looser coupling than a
          // direct service call, and avoids a module dependency cycle).
          this.eventEmitter.emit(COPILOT_REPORT_COMPLETED_EVENT, { reportId });
        }
      }

      if (dto.transcripts && dto.transcripts.length > 0) {
        await this.scenarioReportTranscriptService.addTranscripts(
          reportId,
          dto.transcripts,
        );
      }

      this.scenarioReportNotificationService.notifyUpdate(
        report.createdBy,
        reportId,
      );
    }

    return this.getScenarioReportById(reportId);
  }

  async getScenarioReportTranscripts(
    reportId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ScenarioReportTranscriptResponseDto> {
    // Previously this threw `BadRequestException` for any non-COMPLETED
    // report. That guard predates the live transcript streaming feature
    // — the studio now polls this endpoint every 3s WHILE a report is
    // generating to show each turn as ai-learn produces it. Throwing 400
    // for IN_PROGRESS reports killed the live caption view (polling
    // promise rejected, caught and silently swallowed in the frontend).
    //
    // We still validate the report exists (via getScenarioReportById,
    // which 404s on unknown ids and does the tenant/auth check). Any
    // status is now allowed to read its transcripts — STARTED / IN_PROGRESS
    // returns whatever has streamed in, CANCELLED returns the partial
    // run, COMPLETED returns the full canonical transcript.
    await this.getScenarioReportById(reportId);

    return this.scenarioReportTranscriptService.getScenarioReportTranscripts(
      reportId,
      options,
    );
  }

  async handleExpiredReportGeneration(reportId: string): Promise<void> {
    const report = await this.scenarioReportRepository.findOne({
      where: { id: reportId },
    });
    if (!report || SCENARIO_REPORT_END_STATUSES.includes(report.status)) {
      return;
    }
    const timeoutCutoff = new Date(
      new Date().getTime() -
        SCENARIO_REPORT_TIMEOUT_MINUTES * TIME.MINUTE_IN_MS,
    );
    if (report.createdAt > timeoutCutoff) {
      return;
    }
    const result = await this.scenarioReportRepository.update(
      {
        id: reportId,
        status: In(SCENARIO_REPORT_PENDING_STATUSES),
      },
      {
        status: ScenarioReportStatus.FAILED,
        metadata: { error: 'Failed due to timeout' } as Record<string, any>,
        endedAt: new Date(),
      },
    );
    if (result.affected && result.affected > 0) {
      this.logger.info(
        `Marked scenario report ${reportId} as FAILED due to TTL expiration`,
      );
      this.scenarioReportNotificationService.notifyUpdate(
        report.createdBy,
        reportId,
      );
    }
  }

  async findStalePendingScenarioReports(): Promise<ScenarioReport[]> {
    const cutoff = new Date(
      new Date().getTime() -
        SCENARIO_REPORT_TIMEOUT_MINUTES * TIME.MINUTE_IN_MS,
    );
    return this.scenarioReportRepository.find({
      where: {
        status: In(SCENARIO_REPORT_PENDING_STATUSES),
        createdAt: LessThan(cutoff),
      },
    });
  }

  async markStaleReportsAsFailed(): Promise<void> {
    const staleReports = await this.findStalePendingScenarioReports();
    try {
      const result = await this.scenarioReportRepository.update(
        {
          id: In(staleReports.map((report) => report.id)),
          status: In(SCENARIO_REPORT_PENDING_STATUSES),
        },
        {
          status: ScenarioReportStatus.FAILED,
          metadata: { error: 'Failed due to timeout' } as Record<string, any>,
          endedAt: new Date(),
        },
      );
      if (result.affected && result.affected > 0) {
        this.logger.info(
          `Marked ${result.affected} stale scenario reports as FAILED due to TTL expiration`,
        );
        for (const report of staleReports) {
          this.scenarioReportNotificationService.notifyUpdate(
            report.createdBy,
            report.id,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to mark ${staleReports.length} stale scenario reports as FAILED due to TTL expiration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (staleReports.length > 0) {
      this.logger.debug(
        `Cron fallback marked ${staleReports.length} stale scenario report(s) as FAILED due to TTL expiration`,
      );
    }
  }
}
