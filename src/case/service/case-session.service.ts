import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { CaseSessionRepository } from '../repository/case-session.repository';
import { CaseSessionFilterOptions } from '../type/case-session-items.type';
import { CaseSessionsResponseDto } from '../dto/case-session.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { CaseSharedService } from './case-shared.service';
import { CaseSortBy, CaseStatus } from '../type/cases.type';
import { SessionItemStatus } from 'src/common/type/common.type';
import { CaseSessionItemRepository } from '../repository/case-session-item.repository';
import { DataSource, EntityManager } from 'typeorm';
import { CaseSession } from '../entity/case-session.entity';
import { CaseSessionItem } from '../entity/case-session-item.entity';
import { GetUpcomingCaseItemResponseDto } from '../dto/get-case.dto';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class CaseSessionService {
  private readonly logger = LoggerService.getInstance(CaseSessionService.name);
  constructor(
    private readonly caseSessionRepository: CaseSessionRepository,
    private readonly caseSharedService: CaseSharedService,
    private readonly caseSessionItemRepository: CaseSessionItemRepository,
    private readonly dataSource: DataSource,
    private readonly configService: AppConfigService,
  ) {}

  async getUserCaseSessions(
    filters?: CaseSessionFilterOptions,
  ): Promise<CaseSessionsResponseDto> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const cases = await this.caseSharedService.getCasesWithSession({
      userId: Number(userId),
      tenantId,
      limit: filters?.limit,
      offset: filters?.offset,
      sortBy: filters?.sortBy as CaseSortBy | undefined,
      order: filters?.order,
      status: CaseStatus.ACTIVE,
    });

    const { data, count } = cases;

    const formattedData = data.map((caseData) => ({
      id: caseData.id,
      title: caseData.title,
      description: caseData.description,
      coverImageUrl: caseData.coverImageUrl,
      totalScenarios: caseData.totalScenarios,
      completedScenarios: caseData.session?.completedScenarios,
    }));

    return {
      data: formattedData,
      count,
    };
  }

  async getUserCaseItems(caseId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const caseData = await this.caseSharedService.getActiveCaseById(caseId);
    if (!caseData) {
      throw new NotFoundException('Case not found');
    }
    const caseWithScenarios = await this.caseSharedService.getCaseWithScenarios(
      caseId,
      tenantId,
    );

    const caseSession = await this.caseSessionRepository.findOne({
      where: { caseId, userId: Number(userId) },
    });

    if (!caseSession) {
      return {
        ...caseWithScenarios,
        completedScenarios: 0,
        completedAt: null,
        caseSessionId: null,
        scenarios: caseWithScenarios.scenarios.map((scenario) => ({
          ...scenario,
          sessionId: null,
          status:
            scenario.order > 1
              ? SessionItemStatus.LOCKED
              : SessionItemStatus.UNLOCKED,
        })),
      };
    }

    const caseSessionItems = await this.caseSessionItemRepository.find({
      where: { caseSessionId: caseSession.id },
    });

    const sessionItemsMap = new Map(
      caseSessionItems.map((item) => [item.caseItemId, item]),
    );

    return {
      ...caseWithScenarios,
      completedScenarios: caseSession.completedScenarios,
      completedAt: caseSession.completedAt,
      caseSessionId: caseSession.id,
      scenarios: caseWithScenarios.scenarios.map((scenario) => {
        const caseSessionItem = sessionItemsMap.get(scenario.id);
        return {
          ...scenario,
          sessionId: caseSessionItem?.id,
          status: caseSessionItem?.status || SessionItemStatus.LOCKED,
        };
      }),
    };
  }

  async createUserCaseSession(caseId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const existingCaseSession = await this.getUserCaseSessionByCaseId(caseId);
    if (existingCaseSession?.id) {
      this.logger.error(
        `Case session already exists for userId: ${userId} and caseId: ${caseId}`,
      );
      throw new BadRequestException('Case session already exists');
    }

    return await this.dataSource.transaction(
      async (entityManager: EntityManager) => {
        const caseSessionRepo = entityManager.getRepository(CaseSession);
        const caseSessionItemRepo =
          entityManager.getRepository(CaseSessionItem);
        const caseSessionEntityInstance = caseSessionRepo.create({
          caseId,
          userId: Number(userId),
          startedAt: new Date(),
          completedScenarios: 0,
        });
        const caseSession = await caseSessionRepo.save(
          caseSessionEntityInstance,
        );
        const caseItems = await this.caseSharedService.getCaseItems(caseId);
        if (!caseItems || caseItems.length === 0) {
          this.logger.error(
            `Error: No case items available for userId: ${userId} and caseId: ${caseId}`,
          );
          throw new BadRequestException(
            'No sub simulations available for this case',
          );
        }
        //Taking the first element as the list is sorted by order
        const caseSessionItemEntityInstance = caseSessionItemRepo.create({
          caseSessionId: caseSession.id,
          caseItemId: caseItems[0].id,
          userId: Number(userId),
          status: SessionItemStatus.UNLOCKED,
        });
        const caseSessionItem = await caseSessionItemRepo.save(
          caseSessionItemEntityInstance,
        );
        return {
          caseSessionItemId: caseSessionItem.id,
        };
      },
    );
  }

  async getUserCaseSessionByCaseId(caseId: string) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.caseSessionRepository.findOne({
      where: { caseId, userId: Number(userId) },
    });
  }

  async getCaseSessionByCaseId(caseId: string) {
    return this.caseSessionRepository.findOne({
      where: { caseId },
    });
  }

  async getNextCaseItem(
    scenarioSessionId: string,
  ): Promise<GetUpcomingCaseItemResponseDto | null> {
    const currentScenarioSession =
      await this.caseSharedService.getScenarioSessionById(scenarioSessionId);
    const caseSessionItemId = currentScenarioSession?.caseSessionItemId;
    if (!caseSessionItemId) {
      this.logger.info(
        `Case session item not found for scenarioSessionId: ${scenarioSessionId}`,
      );
      return null;
    }
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const currentCaseSessionItem = await this.caseSessionItemRepository.findOne(
      {
        where: { id: caseSessionItemId, userId: Number(userId) },
      },
    );
    if (!currentCaseSessionItem) {
      this.logger.error(
        `Error: Case session item not found for userId: ${userId} and caseSessionItemId: ${caseSessionItemId}`,
      );
      throw new BadRequestException('Case session item not found');
    }
    const currentCaseItem = await this.caseSharedService.getCaseItemById(
      currentCaseSessionItem.caseItemId,
    );
    let currentScenarioData;
    if (currentCaseItem?.caseId) {
      currentScenarioData = await this.caseSharedService.getScenarioDataById(
        currentCaseItem?.scenarioId,
      );
    }
    const currentCaseSession = await this.caseSessionRepository.findOne({
      where: {
        caseId: currentCaseItem?.caseId,
        userId: Number(userId),
      },
    });

    const currentSession = {
      scenarioId: currentScenarioData?.id,
      title: currentScenarioData?.title,
      description: currentScenarioData?.description,
      coverImageUrl: currentScenarioData?.coverImageUrl,
      coverVideoUrl: currentScenarioData?.coverVideoUrl,
      caseSessionItemStatus: currentCaseSessionItem?.status,
      caseSessionItemId: currentCaseSessionItem?.id,
      transitionMessageTitle: currentCaseItem?.messageTitle,
      transitionMessageContent: currentCaseItem?.messageContent,
      isCaseSessionCompleted: !!currentCaseSession?.completedAt,
      eventStatus: currentScenarioSession?.eventStatus,
    };
    if (
      currentCaseSessionItem?.status !== SessionItemStatus.COMPLETED ||
      !!currentCaseSession?.completedAt
    ) {
      return {
        currentSession,
      };
    }

    const nextScenarioData =
      await this.caseSharedService.getNextScenarioDataByCaseItemId(
        currentCaseSessionItem?.caseItemId,
      );
    let nextCaseSessionItem;
    if (nextScenarioData?.caseItem?.id) {
      nextCaseSessionItem = await this.caseSessionItemRepository.findOne({
        where: {
          caseItemId: nextScenarioData?.caseItem?.id,
          userId: Number(userId),
        },
      });
    }

    const upcomingScenario = nextScenarioData
      ? {
          id: nextScenarioData?.scenario?.id,
          title: nextScenarioData?.scenario?.title,
          description: nextScenarioData?.scenario?.description,
          coverImageUrl: nextScenarioData?.scenario?.coverImageUrl,
          coverVideoUrl: nextScenarioData?.scenario?.coverVideoUrl,
          caseSessionItemStatus: nextCaseSessionItem?.status,
          order: nextScenarioData?.caseItem?.order,
          caseSessionItemId: nextCaseSessionItem?.id,
        }
      : undefined;

    return {
      currentSession,
      upcomingScenario,
    };
  }

  async handleEndCaseSession({
    caseSessionItemId,
    score,
    callDuration = 0,
  }: {
    caseSessionItemId: string;
    score?: number;
    callDuration: number;
  }) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const callDurationInSeconds = (callDuration ?? 0) / 1000;
    const callDurationRequiredForCompletionInSeconds =
      this.configService.cases.caseItemMinDurationForCompletion ?? 0;
    if (callDurationInSeconds < callDurationRequiredForCompletionInSeconds) {
      this.logger.info(
        `Call duration ${callDurationInSeconds} is less than required ${callDurationRequiredForCompletionInSeconds} for caseSessionItemId: ${caseSessionItemId}`,
      );
      return;
    }

    const currentCaseSessionItem = await this.caseSessionItemRepository.findOne(
      {
        where: { id: caseSessionItemId },
      },
    );
    if (!currentCaseSessionItem) {
      this.logger.error(
        `Case session item not found for caseSessionItemId: ${caseSessionItemId}`,
      );
      throw new BadRequestException('Case session item not found');
    }

    if (currentCaseSessionItem.status === SessionItemStatus.COMPLETED) {
      this.logger.info(
        `Case session item already completed for caseSessionItemId: ${caseSessionItemId}`,
      );
      return;
    }

    const currentCaseItem = await this.caseSharedService.getCaseItemById(
      currentCaseSessionItem.caseItemId,
    );
    if (!currentCaseItem) {
      this.logger.error(
        `Error: Case item not found for caseSessionItemId: ${caseSessionItemId}`,
      );
      throw new BadRequestException('Case item not found');
    }

    // Score less than minimum score -> cant make the session complete
    if (
      currentCaseItem?.minimumScore !== undefined &&
      (score ?? 0) < currentCaseItem?.minimumScore
    ) {
      this.logger.info(
        `Score ${score} is less than minimum score ${currentCaseItem?.minimumScore} for caseSessionItemId: ${caseSessionItemId}`,
      );
      return;
    }

    const currentCaseSession = await this.caseSessionRepository.findOne({
      where: { id: currentCaseSessionItem.caseSessionId },
    });
    if (!currentCaseSession) {
      this.logger.error(
        `Error: Case session not found for caseSessionItemId: ${caseSessionItemId}`,
      );
      throw new BadRequestException('Case session not found');
    }

    return await this.dataSource.transaction(
      async (entityManager: EntityManager) => {
        const caseSessionItemRepo =
          entityManager.getRepository(CaseSessionItem);
        const caseSessionRepo = entityManager.getRepository(CaseSession);

        await caseSessionItemRepo.update(currentCaseSessionItem.id, {
          status: SessionItemStatus.COMPLETED,
        });
        this.logger.info(
          `Updated case session item status to COMPLETED for caseSessionItemId: ${caseSessionItemId}`,
        );

        const nextCaseItem =
          await this.caseSharedService.getNextCaseItemByCurrentItemId(
            currentCaseSessionItem.caseItemId,
          );

        // All sub items are complete
        if (!nextCaseItem) {
          await caseSessionRepo.update(currentCaseSession.id, {
            completedAt: new Date(),
            completedScenarios:
              (currentCaseSession?.completedScenarios ?? 0) + 1,
          });
          this.logger.info(
            `Updated case session to completed for caseSessionId: ${currentCaseSession.id}`,
          );
          return;
        }
        await caseSessionRepo.update(currentCaseSession.id, {
          completedScenarios: (currentCaseSession?.completedScenarios ?? 0) + 1,
        });
        const nextCaseSessionItem =
          await this.caseSessionItemRepository.findOne({
            where: {
              caseItemId: nextCaseItem?.id,
              userId: Number(userId),
            },
          });

        // If no entry created for next case item, create one
        // Wouldn't reach ideally
        if (!nextCaseSessionItem?.id) {
          // No entry created for next scenario
          const nextSessionItemEntity = caseSessionItemRepo.create({
            caseSessionId: currentCaseSession.id,
            caseItemId: nextCaseItem.id,
            userId: Number(userId),
            status: SessionItemStatus.UNLOCKED,
          });
          await caseSessionItemRepo.save(nextSessionItemEntity);
          this.logger.info(
            `Created and unlocked next case session item for caseSessionItemId: ${caseSessionItemId}`,
          );
          return;
        }
        return;
      },
    );
  }
}
