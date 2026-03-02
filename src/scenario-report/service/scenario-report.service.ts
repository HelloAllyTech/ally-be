import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
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
import { SCENARIO_REPORT_END_STATUSES } from '../constants/scenario-report.constant';
import { AiService } from '../../ai/service/ai.service';
import { SharedLanguageService } from '../../language/service/shared-language.service';
import { LoggerService } from '../../logger/logger.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { ScenarioReportTranscriptResponseDto } from '../dto/scenario-report-transcript.dto';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { Languages } from 'src/language/entity/languages.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';

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
  ) {}

  async createScenarioReport(
    scenarioId: number,
    createScenarioReportDto: CreateScenarioReportDto,
    userId: number,
  ): Promise<CreateScenarioReportResponseDto> {
    //Check if there are any scenario reports in progress for the same scenario
    await this.checkForInProgressScenarioReports(scenarioId);
    //Check if the scenario has all the active mandatory fields
    const scenario =
      await this.scenarioSharedService.getScenarioById(scenarioId);
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
      config: { ...createScenarioReportDto },
      createdBy: userId,
      updatedBy: userId,
    });
    const scenarioReport =
      await this.scenarioReportRepository.save(scenarioReportEntity);

    this.scenarioReportNotificationService.notifyUpdate(
      scenarioReport.createdBy,
      scenarioReport.id,
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

      await this.aiService.triggerScenarioReportGenerate({
        prompt: report.config.helperAgentPrompt,
        turns: report.config.turns,
        language: languageCode,
        scenario_id: report.scenarioId,
        report_id: report.id,
        metadata: metadata,
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
      this.logger.error(
        `Scenario report generation failed for report ${report.id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      await this.scenarioReportRepository.update(report.id, {
        status: ScenarioReportStatus.FAILED,
        updatedBy: report.updatedBy,
      });

      this.scenarioReportNotificationService.notifyUpdate(
        report.createdBy,
        report.id,
      );
    }
  }

  async getScenarioReportById(reportId: string): Promise<ScenarioReportDto> {
    const scenarioReport = await this.scenarioReportRepository.findOne({
      where: { id: reportId },
    });
    if (!scenarioReport) {
      throw new NotFoundException('Scenario report not found');
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
    };
  }

  async getScenarioReports(
    scenarioId: number,
    statuses?: string,
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
      await this.scenarioReportRepository.findAndCount({
        where: {
          scenarioId,
          ...(statusList.length > 0 && { status: In(statusList) }),
        },
      });

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
    const report = await this.getScenarioReportById(reportId);

    if (SCENARIO_REPORT_END_STATUSES.includes(report.status)) {
      throw new BadRequestException(
        'Cannot update scenario report that is already completed, cancelled, or failed',
      );
    }

    const updatePayload: Partial<ScenarioReport> = {};
    if (dto.metrics !== undefined) updatePayload.metrics = dto.metrics;
    if (dto.status !== undefined) {
      updatePayload.status = dto.status;
      if (SCENARIO_REPORT_END_STATUSES.includes(dto.status)) {
        updatePayload.endedAt = new Date();
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.scenarioReportRepository.update(reportId, updatePayload);
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

    return this.getScenarioReportById(reportId);
  }

  async getScenarioReportTranscripts(
    reportId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ScenarioReportTranscriptResponseDto> {
    const report = await this.getScenarioReportById(reportId);
    if (report.status !== ScenarioReportStatus.COMPLETED) {
      throw new BadRequestException(
        'Cannot get transcripts for a scenario report that is not completed',
      );
    }

    return this.scenarioReportTranscriptService.getScenarioReportTranscripts(
      reportId,
      options,
    );
  }
}
