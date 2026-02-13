import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { CaseRepository } from '../repository/case.repository';
import { CaseTenantRepository } from '../repository/case-tenant.repository';
import { CaseItemRepository } from '../repository/case-item.repository';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { GetCaseItemResponseDto } from '../dto/get-case-response.dto';
import { CaseTenantService } from './case-tenant.service';
import {
  CaseStatus,
  CaseWithSessionFilterOptions,
  CasesWithSession,
} from '../type/cases.type';
import { CaseItem } from '../entity/case-item.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { CaseSessionItemRepository } from '../repository/case-session-item.repository';
import { SessionItemStatus } from 'src/common/type/common.type';
import { DataSource, In } from 'typeorm';
import { CaseSessionRepository } from '../repository/case-session.repository';

@Injectable()
export class CaseSharedService {
  private readonly logger = LoggerService.getInstance(CaseSharedService.name);
  constructor(
    private readonly caseRepository: CaseRepository,
    private readonly caseTenantRepository: CaseTenantRepository,
    private readonly caseItemRepository: CaseItemRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly caseTenantService: CaseTenantService,
    private readonly caseSessionItemRepository: CaseSessionItemRepository,
    private readonly caseSessionRepository: CaseSessionRepository,
    private readonly dataSource: DataSource,
  ) {}

  async getCasesWithSession(
    filters: CaseWithSessionFilterOptions,
  ): Promise<CasesWithSession> {
    const cases = await this.caseRepository.getAllCasesWithSession(filters);
    return cases;
  }

  async getCaseWithScenarios(
    caseId: string,
    tenantId?: string,
  ): Promise<GetCaseItemResponseDto> {
    const result = await this.caseRepository.findOne({
      where: { id: caseId },
    });
    if (!result) {
      this.logger.error(`Case not found for id: ${caseId}`);
      throw new NotFoundException('Case not found');
    }
    if (tenantId) {
      const caseTenant = await this.caseTenantService.getCaseTenant(
        tenantId,
        caseId,
      );
      if (!caseTenant) {
        throw new BadRequestException('Organization access denied');
      }
    }

    const caseItems = await this.caseItemRepository.find({
      where: { caseId },
    });

    const scenarioIds = caseItems.map((item) => item.scenarioId);

    const scenariosData =
      await this.scenarioSharedService.getScenarioWithTriggerWarningsByIds(
        scenarioIds,
      );
    const scenariosDataMap = new Map(
      scenariosData.map((scenario) => [scenario.id, scenario]),
    );

    const scenarios = caseItems.map((item) => {
      const scenarioData = scenariosDataMap.get(item.scenarioId);
      return {
        id: item.id,
        scenarioId: item.scenarioId,
        order: item.order,
        messageTitle: item.messageTitle,
        messageContent: item.messageContent,
        minimumScore: item.minimumScore ?? 0,
        title: scenarioData?.title,
        description: scenarioData?.description,
        coverImageUrl: scenarioData?.coverImageUrl,
        coverVideoUrl: scenarioData?.coverVideoUrl,
        triggerWarnings: scenarioData?.triggerWarnings,
      };
    });

    return {
      id: result.id,
      title: result.title,
      description: result.description,
      coverImageUrl: result.coverImageUrl,
      status: result.status,
      isGlobal: result.isGlobal,
      totalScenarios: result.totalScenarios,
      scenarios,
    };
  }

  async getActiveCaseById(caseId: string) {
    return this.caseRepository.findOne({
      where: { id: caseId, status: CaseStatus.ACTIVE },
    });
  }

  async getCaseItems(caseId: string): Promise<CaseItem[]> {
    return this.caseItemRepository.find({
      where: { caseId },
      order: { order: 'ASC' },
    });
  }

  async getScenarioSessionById(
    scenarioSessionId: string,
  ): Promise<ScenarioSessions | null> {
    return await this.scenarioSharedService.getScenarioSessionById(
      scenarioSessionId,
    );
  }

  async getCaseItemById(caseItemId: string): Promise<CaseItem | null> {
    return this.caseItemRepository.findOne({
      where: { id: caseItemId },
    });
  }

  async getScenarioDataById(scenarioId: number) {
    return await this.scenarioSharedService.getScenarioById(scenarioId);
  }

  async getNextScenarioDataByCaseItemId(caseItemId: string): Promise<{
    scenario: Scenarios | null;
    caseItem: CaseItem;
  } | null> {
    const nextCaseItem = await this.getNextCaseItemByCurrentItemId(caseItemId);
    if (!nextCaseItem) {
      return null;
    }
    const scenarioData = await this.scenarioSharedService.getScenarioById(
      nextCaseItem.scenarioId,
    );
    return { scenario: scenarioData, caseItem: nextCaseItem };
  }

  async getNextCaseItemByCurrentItemId(
    caseItemId: string,
  ): Promise<CaseItem | null> {
    const caseItem = await this.caseItemRepository.findOne({
      where: { id: caseItemId },
    });
    if (!caseItem) {
      return null;
    }
    return await this.caseItemRepository.findOne({
      where: { caseId: caseItem.caseId, order: caseItem.order + 1 },
    });
  }

  async getPreviousCaseItemByCurrentItemId(
    caseItemId: string,
  ): Promise<CaseItem | null> {
    const caseItem = await this.caseItemRepository.findOne({
      where: { id: caseItemId },
    });
    if (!caseItem || caseItem.order <= 1) {
      return null;
    }
    return await this.caseItemRepository.findOne({
      where: { caseId: caseItem.caseId, order: caseItem.order - 1 },
    });
  }

  async getPermittedCaseSessionItemBySessionItemId(caseSessionItemId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.caseSessionItemRepository.findOne({
      where: {
        id: caseSessionItemId,
        userId: Number(userId),
        status: In([SessionItemStatus.UNLOCKED, SessionItemStatus.COMPLETED]),
      },
    });
  }

  async getCaseSessionById(caseSessionId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.caseSessionRepository.findOne({
      where: { id: caseSessionId, userId: Number(userId) },
    });
  }

  async getCaseTenant(tenantId: string, caseId: string) {
    return this.caseTenantRepository.findOne({
      where: { tenantId, caseId },
    });
  }

  async getPreviousCaseMemory(
    caseSessionItemId: string,
  ): Promise<string | null> {
    // Get the current case session item
    const currentCaseSessionItem = await this.caseSessionItemRepository.findOne(
      {
        where: { id: caseSessionItemId },
      },
    );
    if (!currentCaseSessionItem) {
      this.logger.warn(
        `Case session item not found for id: ${caseSessionItemId}`,
      );
      return null;
    }

    //  Get the previous case item (order - 1)
    const previousCaseItem = await this.getPreviousCaseItemByCurrentItemId(
      currentCaseSessionItem.caseItemId,
    );
    if (!previousCaseItem) {
      // First case item or no previous item — no previous memory
      return null;
    }

    const previousCaseSessionItem =
      await this.caseSessionItemRepository.findOne({
        where: {
          caseSessionId: currentCaseSessionItem.caseSessionId,
          caseItemId: previousCaseItem.id,
          userId: currentCaseSessionItem.userId,
        },
      });
    if (!previousCaseSessionItem) {
      this.logger.warn(
        `Previous case session item not found for caseItemId: ${previousCaseItem.id}`,
      );
      return null;
    }

    const previousScenarioSession =
      await this.scenarioSharedService.getPreviousScenarioSessionByCaseSessionItemId(
        previousCaseSessionItem.id,
      );
    if (!previousScenarioSession) {
      this.logger.warn(
        `Scenario session not found for caseSessionItemId: ${previousCaseSessionItem.id}`,
      );
      return null;
    }

    // Get the scenario session details (contains the summary with cumulative_memory)
    const scenarioSessionDetails =
      await this.scenarioSharedService.getScenarioSessionDetailsByScenarioSessionId(
        previousScenarioSession.id,
      );
    if (!scenarioSessionDetails?.summary) {
      this.logger.warn(
        `Scenario session details or summary not found for scenarioSessionId: ${previousScenarioSession.id}`,
      );
      return null;
    }

    const cumulativeMemory =
      scenarioSessionDetails.summary?.feedback?.cumulative_memory ?? null;

    if (!cumulativeMemory) {
      this.logger.warn(
        `cumulative_memory not found in summary for scenarioSessionId: ${previousScenarioSession.id}`,
      );
    }
    return cumulativeMemory;
  }
}
