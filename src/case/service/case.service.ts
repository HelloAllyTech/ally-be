import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCaseDto, CreateCaseResponseDto } from '../dto/create-case.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { DataSource, In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  CaseData,
  CaseFilterOptions,
  CaseItemData,
  CaseStatus,
  CaseTranslations,
  MinimalCaseData,
} from '../type/cases.type';
import {
  CASE_MAX_SCENARIOS,
  CASE_MIN_SCENARIOS,
  CASE_REQUIRED_FIELDS,
} from '../constants/case.constant';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { Case } from '../entity/case.entity';
import { CaseItem } from '../entity/case-item.entity';
import { TenantService } from 'src/tenant/service/tenant.service';
import { CaseTenant } from '../entity/case-tenant.entity';
import { GetCaseResponseDto } from '../dto/case-response.dto';
import { CaseRepository } from '../repository/case.repository';
import { GetCaseItemResponseDto } from '../dto/get-case-response.dto';
import { CaseSharedService } from './case-shared.service';
import { UpdateCaseDto, UpdateCaseResponseDto } from '../dto/update-case.dto';
import { CaseSessionService } from './case-session.service';
import { CaseItemRepository } from '../repository/case-item.repository';
import { UpdateCaseItemDto } from '../dto/update-case-item.dto';
import { SuccessResponse } from 'src/common/type/common.type';
import { DuplicateCaseResponseDto } from '../dto/duplicate-case.dto';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ELIGBLE_APP_LANGUAGES } from 'src/common/constants/translation.constants';

@Injectable()
export class CaseService {
  private readonly logger = LoggerService.getInstance(CaseService.name);
  constructor(
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly dataSource: DataSource,
    private tenantService: TenantService,
    private caseRepository: CaseRepository,
    private caseSharedService: CaseSharedService,
    private caseSessionService: CaseSessionService,
    private caseItemRepository: CaseItemRepository,
    private openaiTranslationsService: OpenAITranslationsService,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}
  async getCases(filters?: CaseFilterOptions): Promise<GetCaseResponseDto> {
    if (filters?.tenantId) {
      const tenant = await this.tenantService.findById(filters.tenantId);
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }
    const result = await this.caseRepository.getAllCases(filters);

    const cases = result.data.map((caseEntity: any) => {
      const { caseTenant, ...caseData } = caseEntity;
      return {
        id: caseData.id,
        title: caseData.title,
        description: caseData.description,
        coverImageUrl: caseData.coverImageUrl,
        status: caseData.status,
        isGlobal: caseData.isGlobal,
        totalScenarios: caseData.totalScenarios,
        isAssignedToTenant: filters?.tenantId ? !!caseTenant : undefined,
        updatedAt: caseData.updatedAt,
      };
    });

    return {
      data: cases,
      count: result.count,
    };
  }

  async getCaseById(id: string): Promise<GetCaseItemResponseDto> {
    return this.caseSharedService.getCaseWithScenarios(id);
  }

  async createCase(
    createCaseDto: CreateCaseDto,
  ): Promise<CreateCaseResponseDto> {
    const { title, description, coverImageUrl, isGlobal, status, scenarios } =
      createCaseDto;
    await this.validateCase(createCaseDto);
    this.logger.info(`Create Case validation passed for the title: ${title}`);
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    return await this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(Case);
      const caseEntity = await caseRepo.save({
        title,
        description,
        coverImageUrl,
        isGlobal,
        status,
        totalScenarios: scenarios?.length,
        ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
      });

      if (scenarios && scenarios.length > 0) {
        const caseItemRepo = manager.getRepository(CaseItem);
        const items = scenarios.map((scenario) =>
          caseItemRepo.create({
            caseId: caseEntity.id,
            scenarioId: scenario.scenarioId,
            order: scenario.order,
            minimumScore: scenario.minimumScore,
            messageTitle: scenario.messageTitle,
            messageContent: scenario.messageContent,
          }),
        );

        await caseItemRepo.save(items);
      }
      if (caseEntity.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const caseTenantRepository = manager.getRepository(CaseTenant);
        const caseTenants = tenantIds.map((tenantId) =>
          caseTenantRepository.create({
            caseId: caseEntity.id,
            tenantId,
          }),
        );
        await caseTenantRepository.save(caseTenants);
      }
      this.logger.info(`Case ${caseEntity.id} created successfully`);
      this.createCaseTranslations(caseEntity.id, { title, description });
      return this.getMinimalCaseData(caseEntity);
    });
  }

  async updateCase(
    id: string,
    updateCaseDto: UpdateCaseDto,
  ): Promise<UpdateCaseResponseDto> {
    const { title, description, coverImageUrl, isGlobal, status, scenarios } =
      updateCaseDto;

    const caseEntity = await this.caseRepository.findOne({
      where: { id },
    });
    if (!caseEntity) {
      this.logger.error(`Case not found for id: ${id}`);
      throw new NotFoundException('Case not found');
    }

    const caseSession =
      await this.caseSessionService.getCaseSessionByCaseId(id);

    if (
      caseEntity.status === CaseStatus.ACTIVE &&
      status === CaseStatus.DRAFT
    ) {
      if (caseSession) {
        throw new BadRequestException(
          'This case cannot be changed to draft because it has active sessions.',
        );
      }
    }

    let existingCaseItems: CaseItemData[] = [];
    if (scenarios) {
      const caseItemsData = await this.caseItemRepository.find({
        where: { caseId: id },
      });
      existingCaseItems = caseItemsData.map((item) => ({
        id: item.id,
        scenarioId: item.scenarioId,
        order: item.order,
        messageTitle: item.messageTitle,
        messageContent: item.messageContent,
        minimumScore: item.minimumScore ?? 0,
      }));
    }

    const updateCase: CaseData = {
      title: caseEntity.title,
      description: caseEntity.description,
      coverImageUrl: caseEntity.coverImageUrl,
      isGlobal: caseEntity.isGlobal,
      ...updateCaseDto,
      scenarios: scenarios ?? existingCaseItems,
    };
    let updatedCaseItems: CaseItemData[];
    if (caseSession) {
      updatedCaseItems = this.validateAndGetUpdatedCaseItems(
        scenarios,
        existingCaseItems,
      );
      updateCase.scenarios = updatedCaseItems;
    }

    await this.validateCase(updateCase);
    this.logger.info(`Update Case ${id} validation passed`);
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    return await this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(Case);
      caseRepo.update(id, {
        title,
        description,
        coverImageUrl,
        isGlobal,
        status,
        totalScenarios: scenarios?.length,
        ...(userId ? { updatedBy: userId } : {}),
      });

      if (scenarios) {
        const caseItemRepo = manager.getRepository(CaseItem);

        if (caseSession) {
          await caseItemRepo.save(updatedCaseItems);
        } else {
          // Delete existing case items
          await caseItemRepo.delete({ caseId: id });

          // Create new case items
          if (scenarios.length > 0) {
            const items = scenarios.map((scenario) =>
              caseItemRepo.create({
                caseId: id,
                scenarioId: scenario.scenarioId,
                order: scenario.order,
                messageTitle: scenario.messageTitle,
                messageContent: scenario.messageContent,
                minimumScore: scenario.minimumScore,
              }),
            );

            await caseItemRepo.save(items);
          }
        }
      }

      const updatedCase = await caseRepo.findOne({
        where: { id },
      });
      if (updatedCase && updateCase.isGlobal !== caseEntity.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const caseTenantRepo = manager.getRepository(CaseTenant);
        if (updatedCase?.isGlobal) {
          await caseTenantRepo.delete({ caseId: id });
          const caseTenantMappings = tenantIds.map((tenantId) => ({
            caseId: id,
            tenantId: tenantId,
          }));
          await caseTenantRepo.save(caseTenantRepo.create(caseTenantMappings));
        } else {
          await caseTenantRepo.delete({
            caseId: id,
            tenantId: In(tenantIds),
          });
        }
      }

      if (
        this.checkIfTranslationRequired(
          { title: caseEntity.title, description: caseEntity.description },
          { title, description },
        )
      ) {
        this.createCaseTranslations(id, { title, description });
      }
      this.logger.info(`Case ${id} updated successfully`);

      return this.getMinimalCaseData(updatedCase!);
    });
  }

  async duplicateCase(id: string): Promise<DuplicateCaseResponseDto> {
    const caseEntity = await this.caseRepository.findOne({
      where: { id },
    });
    if (!caseEntity) {
      throw new NotFoundException('Case not found');
    }

    const caseItems = await this.caseItemRepository.find({
      where: { caseId: id },
    });

    const newCase = {
      title: `Copy of ${caseEntity.title}`,
      description: caseEntity.description,
      coverImageUrl: caseEntity.coverImageUrl,
      status: CaseStatus.DRAFT,
      isGlobal: caseEntity.isGlobal,
      totalScenarios: caseEntity.totalScenarios,
    };

    return await this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(Case);
      const caseItemRepo = manager.getRepository(CaseItem);

      const newCaseData = await caseRepo.save(newCase);

      if (caseItems.length > 0) {
        const newCaseItems = caseItems.map((item) =>
          caseItemRepo.create({
            caseId: newCaseData.id,
            scenarioId: item.scenarioId,
            order: item.order,
            messageTitle: item.messageTitle,
            messageContent: item.messageContent,
            minimumScore: item.minimumScore,
          }),
        );

        await caseItemRepo.save(newCaseItems);
      }
      if (newCaseData.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const caseTenantRepository = manager.getRepository(CaseTenant);
        const caseTenants = tenantIds.map((tenantId) =>
          caseTenantRepository.create({
            caseId: newCaseData.id,
            tenantId,
          }),
        );
        await caseTenantRepository.save(caseTenants);
      }
      this.logger.info(`Case ${id} duplicated successfully`);
      return this.getMinimalCaseData(newCaseData);
    });
  }

  async deleteCase(id: string): Promise<SuccessResponse> {
    const caseEntity = await this.caseRepository.findOne({
      where: { id },
    });
    if (!caseEntity) {
      throw new NotFoundException('case not found');
    }

    const caseSession =
      await this.caseSessionService.getCaseSessionByCaseId(id);
    if (caseSession) {
      this.logger.error(`Delete blocked: Case ${id} has active sessions.`);
      throw new BadRequestException(
        'Cannot delete a case with active sessions',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Case).softDelete(id);
      await manager.getRepository(CaseItem).softDelete({
        caseId: id,
      });
      await manager.getRepository(CaseTenant).softDelete({ caseId: id });
    });

    this.logger.info(`Case ${id} deleted successfully`);
    return { success: true };
  }

  private async validateCase(caseData: CaseData) {
    const scenarios = caseData?.scenarios ?? [];
    const scenariosLength = scenarios.length;
    if (caseData.status === CaseStatus.ACTIVE) {
      const missingFields = CASE_REQUIRED_FIELDS.filter(
        (field) => !caseData[field as keyof CreateCaseDto],
      );
      if (missingFields.length > 0) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} is missing the following required fields: ${missingFields.join(', ')}`,
        );
        throw new BadRequestException(
          `The following required fields are missing: ${missingFields.join(', ')}`,
        );
      }

      if (scenariosLength < CASE_MIN_SCENARIOS) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} must contain at least ${CASE_MIN_SCENARIOS} scenarios.`,
        );
        throw new BadRequestException(
          `A case must contain at least ${CASE_MIN_SCENARIOS} scenarios.`,
        );
      }

      if (scenariosLength > CASE_MAX_SCENARIOS) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} can contain at most ${CASE_MAX_SCENARIOS} scenarios.`,
        );
        throw new BadRequestException(
          `A case can contain at most ${CASE_MAX_SCENARIOS} scenarios.`,
        );
      }
    }

    // while editing a case, when user removes all scenarios in the case, we don't need to validate any scenarios
    if (caseData.scenarios && caseData.scenarios.length === 0) {
      return;
    }

    const scenarioIdsSet: Set<number> = new Set();
    const scenarioOrderSet: Set<number> = new Set();

    for (const scenario of scenarios) {
      if (scenarioIdsSet.has(scenario.scenarioId)) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} has a duplicate scenario: ${scenario.scenarioId}.`,
        );
        throw new BadRequestException('Duplicate scenario found.');
      }
      if (scenarioOrderSet.has(scenario.order)) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} has a duplicate scenario order: ${scenario.order}.`,
        );
        throw new BadRequestException('Duplicate scenario order found.');
      }
      scenarioIdsSet.add(scenario.scenarioId);
      scenarioOrderSet.add(scenario.order);
    }

    for (let i = 1; i <= scenariosLength; i++) {
      if (!scenarioOrderSet.has(i)) {
        this.logger.error(
          `Case ${caseData.id ?? caseData.title} has a missing scenario order: ${i}.`,
        );
        throw new BadRequestException(
          `Scenario order must be sequential starting from 1. Missing order: ${i}`,
        );
      }
    }

    const scenarioIds = [...scenarioIdsSet];

    const existingScenarios = await this.scenarioSharedService.getScenarioByIds(
      scenarioIds,
      { status: ScenarioStatus.ACTIVE },
    );
    const existingScenarioIds = existingScenarios.map(
      (scenario) => scenario.id,
    );

    const missingScenarioIds = scenarioIds.filter(
      (id) => !existingScenarioIds.includes(id),
    );

    if (missingScenarioIds.length > 0) {
      this.logger.error(
        `Case: ${caseData.id ?? caseData.title} validation failed: Invalid scenario IDs: ${missingScenarioIds}`,
      );
      throw new BadRequestException(
        `Invalid or inactive scenario IDs: ${missingScenarioIds}`,
      );
    }
  }

  private getMinimalCaseData(caseData: Case): MinimalCaseData {
    return {
      id: caseData.id,
      title: caseData.title,
      description: caseData.description,
      coverImageUrl: caseData.coverImageUrl,
      status: caseData.status,
    };
  }

  private validateAndGetUpdatedCaseItems(
    inputCaseItems?: UpdateCaseItemDto[],
    existingCaseItems?: CaseItemData[],
  ): CaseItemData[] {
    // If one is undefined and the other is not, return false
    if (!inputCaseItems || !existingCaseItems) {
      throw new BadRequestException('Invalid case items');
    }

    if (inputCaseItems.length !== existingCaseItems.length) {
      throw new BadRequestException(
        'Cannot add or remove scenarios because this case already has active sessions',
      );
    }

    // Check if all scenarioIds from input exist in existing and their orders match
    const updatedCaseItems: CaseItemData[] = [];
    inputCaseItems.forEach((inputItem) => {
      const existingItem = existingCaseItems.find(
        (existingItem) =>
          existingItem.scenarioId === inputItem.scenarioId &&
          existingItem.order === inputItem.order,
      );
      if (!existingItem) {
        throw new BadRequestException('Case item not found');
      }
      updatedCaseItems.push({
        ...inputItem,
        id: existingItem.id,
      });
    });

    return updatedCaseItems;
  }

  private async createCaseTranslations(
    caseId: string,
    caseData: CaseTranslations,
  ) {
    const validLanguagesCodes: number[] =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (!validLanguagesCodes || validLanguagesCodes.length === 0) {
      return;
    }

    let languageCodes =
      await this.sharedLanguageService.getValidLanguageCodes(
        validLanguagesCodes,
      );

    languageCodes = languageCodes?.filter((languageCode) => {
      return ELIGBLE_APP_LANGUAGES.includes(languageCode);
    });

    if (!languageCodes || languageCodes.length === 0) {
      return;
    }

    const translatedCase =
      await this.openaiTranslationsService.translateObjectToLanguages(
        caseData,
        languageCodes,
        'openai_translation_speech_reexpression_user',
      );

    if (translatedCase) {
      await this.caseRepository.update(caseId, {
        translations: translatedCase,
      } as any);
    }

    return false;
  }

  private checkIfTranslationRequired(
    OldcaseData: CaseTranslations,
    newCaseData: CaseTranslations,
  ) {
    const { title, description } = newCaseData;
    const { title: oldTitle, description: oldDescription } = OldcaseData;

    if (
      title?.trim().toLowerCase() !== oldTitle?.trim().toLowerCase() ||
      description?.trim().toLowerCase() !== oldDescription?.trim().toLowerCase()
    ) {
      return true;
    }

    return false;
  }

  async makeTranslationsForCases() {
    const cases = await this.caseRepository.find({
      select: ['id', 'title', 'description'],
    });

    for (const caseData of cases) {
      const translations =
        await this.openaiTranslationsService.translateObjectToLanguages(
          {
            title: caseData.title,
            description: caseData.description,
          },
          ELIGBLE_APP_LANGUAGES,
          'openai_translation_speech_reexpression_user',
        );

      if (translations) {
        await this.caseRepository.update(caseData.id, {
          translations,
        } as any);
      }
    }

    return true;
  }
}
