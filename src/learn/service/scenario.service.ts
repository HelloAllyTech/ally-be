import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager, In } from 'typeorm';

async function executeInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioEngine } from '../enum/scenario-engine.enum';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { validateSimulationStates } from '../util/validate-simulation-states.util';
import { buildGeneratedStates } from '../util/build-generated-states.util';

import { ScenariosRepository } from '../repository/scenario.repository';

import { ScenarioVoices } from '../entity/scenario-voices.entity';
import { CreateScenarioVoicesDto } from '../dto/create-scenario-voices.dto';
import { UpdateScenarioVoiceDto } from '../dto/update-scenario-voice.dto';
import {
  CreateScenarioEventsDto,
  EventMappingDto,
} from '../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../dto/delete-scenario-events.dto';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import {
  ScenarioAppLangugeTranslations,
  ScenarioStatus,
} from '../type/scenario.type';
import { SCENARIO_STATUS_MAP } from 'src/learn/constants/scenario-status.map';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioImageUploadRequestDto } from '../dto/scenario-image-upload-request.dto';
import { ScenarioImageUploadResponseDto } from '../dto/scenario-image-upload-response.dto';
import { ScenarioImageUploadContentType } from '../enum/scenario-image-upload-content-type.enum';
import { ScenarioEventsRepository } from '../repository/scenario-events.repository';
import { DeleteCoverImageDto } from '../dto/delete-cover-image.dto';
import { LoggerService } from 'src/logger/logger.service';
import { ScenarioVideoUploadRequestDto } from '../dto/scenario-video-upload-request.dto';
import { ScenarioVideoUploadResponseDto } from '../dto/scenario-video-upload-response.dto';
import { ScenarioVideoUploadContentType } from '../enum/scenario-video-upload-content-type';
import { DeleteCoverVideoDto } from '../dto/delete-cover-video.dto';
import {
  UPLOADED_VIDEO_FILE_DURATION_LIMIT,
  UPLOADED_VIDEO_FILE_SIZE_LIMIT,
} from '../constants/scenario-cover-video.constants';
import {
  GetAdminScenarioDto,
  GetScenarioDto,
  GetScenarioDtoWithPagination,
} from '../dto/get-scenario.dto';
import {
  formatScenarioTriggerWarningsList,
  getActiveScenarioMandatoryFields,
  mapCreateScenarioRequestToEntity,
  mapUpdateScenarioRequestToEntity,
  formatAutoTerminationEventsList,
  applyScenarioTranslations,
} from '../util/scenario.util';
import { sanitizeJsonbMetadata } from 'src/common/util/sanitize-jsonb.util';
import { TenantService } from 'src/tenant/service/tenant.service';
import { ScenarioTenants } from '../entity/scenario-tenants.entity';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import {
  GetScenarioByIdOptions,
  ScenarioFilters,
} from '../type/scenario-filter.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { GetScenarioResponse } from '../interface/session.interface';
import { TriggerWarningsService } from './trigger-warnings.service';
import { ScenarioTranslationsRepository } from '../repository/scenario-translations.repository';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { SharedLanguageService } from '../../language/service/shared-language.service';
import { ScenarioSharedService } from './scenario-shared.service';
import { ScenarioEventsTranslationsRepository } from '../repository/scenario-events-translations.repository';
import {
  MetadataShape,
  TranslationConsiderableData,
} from '../type/scenario-translation-metadata.type';
import {
  CreateScenarioTranslation,
  UpdateScenarioTranslation,
} from '../interface/scenario-translation.interface';
import {
  CreateScenarioEventsTranslation,
  ScenarioEventsTranslationData,
} from '../interface/scenario-events-translation.interface';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from '../constants/scenario-session.constants';
import { TerminationEventsDto } from '../dto/termination-events.dto';
import isDuplicateKeyException from 'src/exception/custom.exception';
import {
  BRANCHING_INSTRUCTION_DYNAMIC_SHORTCUTS,
  LOWER_MAX_TIMER_VALUE,
  SCENARIO_FIELDS,
  UPPER_MAX_TIMER_VALUE,
} from '../constants/scenario.constants';
import {
  wrapFieldPlaceholders,
  unwrapFieldPlaceholders,
} from 'src/session-event/util/session-event.util';
import {
  OpenAITranslationsService,
  TranslationProgressCallback,
} from 'src/common/service/openai-translation.service';
import { ScenarioTranslationNotificationService } from './scenario-translation-notification.service';
import {
  ScenarioTranslationAction,
  ScenarioTranslationStatus,
} from '../enum/scenario-translation.enum';
import { randomUUID } from 'crypto';
import { ScenarioReportService } from 'src/scenario-report/service/scenario-report.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import { ScenarioBehaviorInstructionService } from './scenario-behavior-instruction.service';
import { ScenarioBehaviorInstructionRequest } from '../type/scenario-behavior-instructions.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { OpenAIAutofillService } from './openai-autofil-service';
import { AnthropicAutofillService } from './anthropic-autofill.service';
import { ENHANCE_AUTO_IMPROVE_INSTRUCTION } from '../util/autofill-shared.util';
import {
  EnhanceScenarioFieldDto,
  EnhanceScenarioFieldResponseDto,
} from '../dto/enhance-scenario-field.dto';
import {
  EnhanceableField,
  ENHANCEABLE_FIELD_LABELS,
  ENHANCE_FIELD_PROMPT_CODE,
  ENHANCE_STATE_PROMPT_CODE,
} from '../enum/enhanceable-field.enum';
import { CompetencyService } from './competency.service';
import { BehaviorService } from './behavior.service';
import { AgentBuilderField } from '../enum/agent-builder-field.enum';
import {
  GenerateAgentBuilderFieldDto,
  GenerateAgentBuilderFieldResponseDto,
} from '../dto/generate-agent-builder-field.dto';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  getLlmModels,
  LlmRuntime,
  LlmProviderName,
} from 'src/llm/constants/llm-model-registry.constants';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  buildAvailableLanguagesMap,
  getDistinctScenarioLanguageIds,
  getLanguageVoiceIds,
} from 'src/common/util/language-availability.util';
import {
  isValidTimeFormatHHMMSS,
  parseTimeToSeconds,
} from 'src/common/util/time.util';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { User } from 'src/user/entity/user.entity';
import { isRoleplayV2EmailAllowed } from 'src/common/util/roleplay-v2-access.util';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import {
  AUDIT_ACTIONS,
  AUDIT_EVENTS,
} from 'src/audit/constants/audit-event.constants';
import { BehaviorInstructionDto } from '../dto/behavior-instruction.dto';

@Injectable()
export class ScenarioService {
  private readonly logger = LoggerService.getInstance(ScenarioService.name);
  static REQUIRED_CONTEXT_FIELDS: any;

  constructor(
    private scenariosRepository: ScenariosRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private sessionEventSharedService: SessionEventSharedService,
    private readonly sessionEventTranslationService: SessionEventTranslationService,
    private tenantService: TenantService,
    private scenarioVoiceRepository: ScenarioVoicesRepository,
    private s3Service: S3Service,
    private configService: AppConfigService,
    private dataSource: DataSource,
    private scenarioPathSharedService: ScenarioPathSharedService,
    private caseSharedService: CaseSharedService,
    private triggerWarningsService: TriggerWarningsService,
    private scenarioTranslationsRepository: ScenarioTranslationsRepository,
    private googleTranslationsService: GoogleTranslationsService,
    private openaiTranslationsService: OpenAITranslationsService,
    private sharedLanguageService: SharedLanguageService,
    private scenarioSharedService: ScenarioSharedService,
    private scenarioEventTranslationsRepository: ScenarioEventsTranslationsRepository,
    private scenarioReportService: ScenarioReportService,
    private scenarioBehaviorInstructionService: ScenarioBehaviorInstructionService,
    private competencyService: CompetencyService,
    private openAIAutofillService: OpenAIAutofillService,
    private anthropicAutofillService: AnthropicAutofillService,
    private behaviorService: BehaviorService,
    private permissionsService: PermissionsService,
    private readonly auditLogService: AuditLogService,
    private readonly scenarioTranslationNotificationService: ScenarioTranslationNotificationService,
    private readonly promptSharedService: PromptSharedService,
  ) {}

  async getScenarios(): Promise<GetScenarioDto[]> {
    const { data } = await this.scenariosRepository.getScenarios();
    return data;
  }

  async getPublicScenarios(): Promise<GetScenarioDtoWithPagination> {
    const { data, count } = await this.scenariosRepository.getScenarios({
      isPublic: true,
    });

    return { data, count };
  }

  async getScenariosV2(
    languageCode?: string,
  ): Promise<GetScenarioDtoWithPagination> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    // v2 scenarios are only listed for a v2-allowlisted requester (e.g. the
    // tester); every other learner sees the v1 catalog exactly as before and
    // never encounters a v2 scenario (nor its rollout-gate 403).
    const includeRoleplayV2 = await this.isCurrentUserRoleplayV2Allowed();
    const { data: fetchedData, count } =
      await this.scenariosRepository.getScenarios({
        tenantId,
        ...(languageCode && { languageCode }),
        ...(includeRoleplayV2 && { includeRoleplayV2: true }),
      });
    let data = fetchedData;

    const languageIds = getDistinctScenarioLanguageIds(data);

    const languages = languageIds.length
      ? await this.sharedLanguageService.getLanguagesByIds(languageIds)
      : [];

    const availableLanguagesMap = buildAvailableLanguagesMap(languages);

    data = data.map((scenario: any) => {
      const languageVoiceIds = getLanguageVoiceIds(
        scenario?.metadata?.languageVoices,
      );

      delete scenario?.metadata;
      return {
        ...scenario,
        availableLanguages: languageVoiceIds.length
          ? languageVoiceIds
              .map((languageId) => availableLanguagesMap.get(languageId))
              .filter(Boolean)
          : null,
      };
    });

    if (languageCode) {
      data.forEach((scenario) =>
        applyScenarioTranslations(scenario, languageCode),
      );
      data.forEach((scenario) =>
        scenario.triggerWarnings?.forEach((triggerWarning) => {
          if (
            triggerWarning.translations &&
            triggerWarning.translations[languageCode]
          ) {
            triggerWarning.name =
              triggerWarning.translations[languageCode].name ||
              triggerWarning.name;
          }
        }),
      );
    }

    return { data, count };
  }

  /**
   * Whether the CURRENT request's user may see/use v2 (flag on + allowlisted).
   * Fully defensive: any missing context resolves to false so the safe default
   * is "hide v2". Shares the exact allowlist logic used by the session-start
   * gate (isRoleplayV2EmailAllowed).
   */
  private async isCurrentUserRoleplayV2Allowed(): Promise<boolean> {
    try {
      const config = this.configService.roleplayV2;
      if (!config?.enabled) return false;
      const userId = Number(ExecutionManager.getUserId());
      if (!userId || Number.isNaN(userId)) return false;
      const user = await this.dataSource
        .getRepository(User)
        .findOne({ where: { id: userId }, select: ['id', 'email'] });
      return isRoleplayV2EmailAllowed(user?.email, config);
    } catch {
      return false;
    }
  }

  async getAdminScenarios(
    scenarioFilters?: ScenarioFilters,
    options?: Pagination,
    currentUser?: TokenUser,
  ) {
    const {
      status,
      category,
      partnerOrgName,
      tenantId,
      assignmentStatus,
      search,
    } = scenarioFilters ?? {};
    if (tenantId) {
      const tenant = await this.tenantService.findById(tenantId);
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }

    const isMultiTenantAdmin = currentUser
      ? await this.permissionsService.isMultiTenantAdmin(currentUser.id)
      : false;

    const scenarios = await this.scenariosRepository.getAdminScenarios(
      {
        status,
        category,
        partnerOrgName,
        tenantId,
        assignmentStatus,
        search,
        isMultiTenantAdmin,
        userId: currentUser?.id,
      },
      options,
    );

    const languageIds = getDistinctScenarioLanguageIds(scenarios);

    const languages = languageIds.length
      ? await this.sharedLanguageService.getLanguagesByIds(languageIds)
      : [];

    const availableLanguagesMap = buildAvailableLanguagesMap(languages);
    const mappedData = scenarios.map((item) => {
      const isPreviewEnabled =
        this.scenarioSharedService.hasAllActiveScenarioMandatoryFields(item);

      const languageVoiceIds = getLanguageVoiceIds(
        item?.scenario_metadata?.languageVoices,
      );

      return {
        id: item.scenario_id,
        title: item.scenario_title,
        createdAt: item.scenario_createdAt,
        updatedAt: item.scenario_updatedAt,
        scenario: item.scenario_scenario,
        description: item.scenario_description,
        coverImageUrl: item.scenario_coverImageUrl,
        coverVideoUrl: item.scenario_coverVideoUrl,
        createdBy: item.user_name,
        createdByUserId: item.scenario_createdBy,
        status: item.scenario_status,
        category: item.scenario_category,
        partnerOrgName: item.scenario_partnerOrgName,
        usage: item.usage,
        isAssignedToTenant: item.isAssignedToTenant,
        triggerWarnings: item.triggerWarnings,
        isPreviewEnabled,
        isPublic: item.scenario_isPublic,
        availableLanguages: languageVoiceIds.length
          ? languageVoiceIds
              .map((languageId) => availableLanguagesMap.get(languageId))
              .filter(Boolean)
          : null,
      };
    });

    return { data: mappedData };
  }

  async getScenarioEvents(scenarioId: number, options?: Pagination) {
    const result = await this.scenarioEventsRepository.getScenarioEvents(
      scenarioId,
      options,
    );

    const data = result.data.map((item) => ({
      eventId: item.eventId,
      name: item.sessionEvent?.name,
      feedbackStatus: item.feedbackStatus,
      score: item.score,
      ...(item.feedbackStatus
        ? {
            emoji: item.emoji,
            message: item.message,
          }
        : {
            emoji: item.sessionEvent?.emoji,
            message: item.sessionEvent?.message,
          }),
      branchingStatus: item.branchingStatus,
      ...(item.branchingStatus
        ? {
            branchInstruction: item.branchInstruction,
          }
        : {
            branchInstruction: item.sessionEvent?.branchInstruction,
          }),
      detectionConfig: item.detectionConfig,
      checklistVisibilityStatus: item.checklistVisibilityStatus,
      tags: item.sessionEvent?.tags,
    }));

    return { data, count: result.count };
  }

  async getScenario(
    id: number,
    options?: GetScenarioByIdOptions,
    languageCode?: string,
  ): Promise<GetScenarioResponse> {
    const scenario = await this.scenariosRepository.getScenarioById(id, {
      select: options?.select,
      em: options?.em,
      isPublic: options?.isPublic,
      ...(languageCode && { languageCode }),
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    if (languageCode) {
      applyScenarioTranslations(scenario, languageCode);
      scenario.triggerWarnings?.forEach((triggerWarning) => {
        if (
          triggerWarning.translations &&
          triggerWarning.translations[languageCode]
        ) {
          triggerWarning.name =
            triggerWarning.translations[languageCode].name ||
            triggerWarning.name;
        }
        delete triggerWarning.translations;
      });
    }
    return scenario;
  }

  async getAdminScenario(
    id: number,
    currentUser?: TokenUser,
  ): Promise<GetAdminScenarioDto> {
    const result = await this.scenarioSharedService.getAdminScenario(id);

    if (!result) {
      throw new NotFoundException('Scenario not found');
    }

    if (currentUser) {
      const isMultiTenantAdmin =
        await this.permissionsService.isMultiTenantAdmin(currentUser.id);
      if (isMultiTenantAdmin && result.createdBy !== currentUser.id) {
        throw new ForbiddenException(
          'You do not have permission to view this roleplay',
        );
      }
    }

    return result;
  }

  async getPresignedUrlForScenarioCoverImage(
    scenarioImageUploadRequestDto: ScenarioImageUploadRequestDto,
  ): Promise<ScenarioImageUploadResponseDto> {
    if (
      !Object.values(ScenarioImageUploadContentType).includes(
        scenarioImageUploadRequestDto.contentType,
      )
    ) {
      throw new BadRequestException('Invalid file type');
    }

    if (this.configService.isMockScenarioCoverImageUpload) {
      return {
        presignedUrl: '',
        coverImageUrl: this.configService.mockScenarioCoverImageUrl,
      };
    }

    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }

    const { presignedUrl, imageUrl } =
      await this.s3Service.getPresignedUrlForImageUpload(
        bucket,
        'scenario-cover-images',
        scenarioImageUploadRequestDto.fileName,
        scenarioImageUploadRequestDto.fileSize,
        scenarioImageUploadRequestDto.contentType,
      );

    return { presignedUrl, coverImageUrl: imageUrl };
  }

  async deleteCoverImage(deleteCoverImageDto: DeleteCoverImageDto) {
    if (this.configService.isMockScenarioCoverImageUpload) {
      return { success: true };
    }
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }
    return this.s3Service.deleteS3Image(
      bucket,
      deleteCoverImageDto.coverImageUrl,
    );
  }

  async getPresignedUrlForScenarioCoverVideo(
    scenarioVideoUploadRequestDto: ScenarioVideoUploadRequestDto,
  ): Promise<ScenarioVideoUploadResponseDto> {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }
    const { fileName, fileSize, duration, contentType } =
      scenarioVideoUploadRequestDto;

    if (!Object.values(ScenarioVideoUploadContentType).includes(contentType)) {
      throw new BadRequestException('Invalid file type');
    }

    if (fileSize > UPLOADED_VIDEO_FILE_SIZE_LIMIT) {
      throw new BadRequestException(
        `File size must be less than ${UPLOADED_VIDEO_FILE_SIZE_LIMIT / 1024 / 1024} MB`,
      );
    }

    if (duration > UPLOADED_VIDEO_FILE_DURATION_LIMIT) {
      throw new BadRequestException(
        `File duration must be less than ${UPLOADED_VIDEO_FILE_DURATION_LIMIT}s`,
      );
    }

    const sanitizedFileName = this.s3Service.sanitizeFileName(fileName);

    const storageKey = `scenario-cover-videos/${Date.now()}-${sanitizedFileName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600, //10 min
      contentType,
    });

    const region = this.configService.aws.region;
    const coverVideoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;
    return { presignedUrl, coverVideoUrl };
  }

  async deleteCoverVideo(deleteCoverVideoDto: DeleteCoverVideoDto) {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }

    const coverVideoUrl = deleteCoverVideoDto.coverVideoUrl;
    const s3CoverVideoUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const coverVideoUrlMatch = coverVideoUrl.match(s3CoverVideoUrlPattern);
    const storageKey = coverVideoUrlMatch ? coverVideoUrlMatch[1] : null;

    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 URL: ${coverVideoUrl}`);
      return { success: false };
    }

    try {
      await this.s3Service.deleteObject({
        bucket,
        key: storageKey,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to delete uploaded cover video with error ${JSON.stringify(
          error,
        )}`,
      );
      return { success: false };
    }
  }

  async createScenarios(
    createScenariosDto: CreateScenariosDto,
    userId: number,
  ): Promise<Scenarios[]> {
    const createScenarioDtos = await executeInChunks(
      createScenariosDto.scenarios,
      10,
      async (scenario) => {
        // Prune BEFORE validate so orphaned states from a variant whose
        // body no longer references {state_x_guidelines} don't fail the
        // strict-bounds validator with their legacy null bounds.
        await this.pruneStatesIfPromptNotStateful(scenario);
        await this.validateCreateScenario(scenario);
        return mapCreateScenarioRequestToEntity(scenario, userId);
      },
    );

    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);

    try {
      const savedScenarios = await this.dataSource.transaction(
        async (entityManager) => {
          const scenariosRepo = entityManager.getRepository(Scenarios);
          const scenarioEventsRepo =
            entityManager.getRepository(ScenarioEvents);
          const scenarios = scenariosRepo.create(createScenarioDtos);
          const savedScenarios = await scenariosRepo.save(scenarios);

          if (isMultiTenantAdmin) {
            savedScenarios.forEach((scenario) => {
              this.auditLogService.log({
                eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_EDITED_SCENARIO,
                details: {
                  action: AUDIT_ACTIONS.CREATE_SCENARIO,
                  scenarioId: scenario.id,
                  userId,
                },
              });
            });
          }

          const globalScenarios = savedScenarios.filter(
            (scenario) => scenario.isGlobal,
          );

          if (globalScenarios.length > 0) {
            const tenants = await this.tenantService.findAll();
            const tenantIds = tenants.map((tenant) => tenant.id);

            for (const globalScenario of globalScenarios) {
              const scenarioTenantRepository =
                entityManager.getRepository(ScenarioTenants);
              const scenarioTenant = tenantIds.map((tenantId) =>
                scenarioTenantRepository.create({
                  scenarioId: globalScenario.id,
                  tenantId,
                }),
              );
              await scenarioTenantRepository.save(scenarioTenant);
            }
          }
          const autoTerminationEventList = formatAutoTerminationEventsList(
            createScenariosDto,
            savedScenarios,
          );

          const scenarioTerminationEvents = scenarioEventsRepo.create(
            autoTerminationEventList,
          );

          if (scenarioTerminationEvents.length > 0) {
            await scenarioEventsRepo.save(scenarioTerminationEvents);
            this.createUpdateScenarioEventsTranslations(
              scenarioTerminationEvents,
            );
          }
          const triggerWarningList = formatScenarioTriggerWarningsList(
            createScenariosDto,
            savedScenarios,
          );
          if (triggerWarningList.length > 0) {
            const scenarioTriggerWarningsRepo = entityManager.getRepository(
              ScenarioTriggerWarnings,
            );
            const scenarioTriggerWarnings =
              scenarioTriggerWarningsRepo.create(triggerWarningList);
            await scenarioTriggerWarningsRepo.save(scenarioTriggerWarnings);
          }

          // Create behavior instructions for each scenario
          const scenarioBehaviorInstructionList: ScenarioBehaviorInstructionRequest[] =
            createScenariosDto.scenarios?.map((scenario, index) => ({
              scenarioId: savedScenarios[index].id,
              behaviorInstructions: scenario.behaviorInstructions,
            }));

          const hasAnyBehaviorInstruction =
            scenarioBehaviorInstructionList?.some(
              (item) =>
                item.behaviorInstructions &&
                item.behaviorInstructions.length > 0,
            );

          if (hasAnyBehaviorInstruction)
            await this.scenarioBehaviorInstructionService.createBehaviorInstructions(
              scenarioBehaviorInstructionList,
              entityManager,
            );

          // Persist translations for active scenarios
          const activeScenarios = savedScenarios.filter(
            (scenario) => scenario.status == ScenarioStatus.ACTIVE,
          );

          if (activeScenarios.length > 0) {
            for (const scenario of activeScenarios) {
              const translationConsiderableData: TranslationConsiderableData = {
                currentLocation: scenario.metadata?.currentLocation,
                profession: scenario.metadata?.profession,
                context: scenario.metadata?.context,
                age: scenario.metadata?.age,
                gender: scenario.metadata?.gender,
              };

              this.persistTranslationsForScenarios(
                [scenario],
                () =>
                  this.sanitizeMetadata({
                    title: scenario.title,
                    description: scenario.description,
                    context: scenario.metadata?.context,
                    sexualOrientation: scenario.metadata?.sexualOrientation,
                    genderIdentity: scenario.metadata?.genderIdentity,
                    customFields: scenario.metadata?.customFields,
                    // Phase 2: opening dialogues are not auto-translated; primary stays in
                    // scenario.metadata.openingStatements, others in scenario_translations (upsert).
                    // FEATURE_CLEANUP(FEATURE_SCENARIO_BEHAVIOR_STATE_INSTRUCTIONS): Remove stateInstructions field
                    stateInstructions: scenario.metadata?.stateInstructions,
                    knowledgeSources: scenario.metadata?.knowledgeSources,
                    stateNames: scenario.metadata?.stateNames,
                  }),
                translationConsiderableData,
                undefined,
                {
                  userId,
                  jobId: randomUUID(),
                  action: ScenarioTranslationAction.CREATE,
                },
              );
            }
          }

          return savedScenarios;
        },
      );
      for (let i = 0; i < savedScenarios.length; i++) {
        const dto = createScenariosDto.scenarios[i];
        if (
          dto.translationOpeningStatements &&
          Object.keys(dto.translationOpeningStatements).length > 0
        ) {
          await this.upsertTranslationOpeningStatements(
            savedScenarios[i].id,
            dto.translationOpeningStatements,
            savedScenarios[i].metadata,
          );
        }
        if (
          dto.translationDescription &&
          Object.keys(dto.translationDescription).length > 0
        ) {
          await this.upsertTranslationDescription(
            savedScenarios[i].id,
            dto.translationDescription,
            savedScenarios[i].metadata,
          );
        }
        if (
          dto.translationTitle &&
          Object.keys(dto.translationTitle).length > 0
        ) {
          await this.upsertTranslationTitle(
            savedScenarios[i].id,
            dto.translationTitle,
            savedScenarios[i].metadata,
          );
        }
        if (
          dto.translationReminders &&
          Object.keys(dto.translationReminders).length > 0
        ) {
          await this.upsertTranslationReminders(
            savedScenarios[i].id,
            dto.translationReminders,
            savedScenarios[i].metadata,
          );
        }
      }

      return savedScenarios;
    } catch (error) {
      this.logger.error(
        `Failed to create scenarios with error ${JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `Failed to create scenarios: ${error.message}`,
      );
    }
  }

  async validateCreateScenario(
    createScenarioDto: CreateScenarioDto,
  ): Promise<void> {
    this.validateScenarioStatus(createScenarioDto);

    if (createScenarioDto.languageVoices) {
      await this.validateLanguageVoices(createScenarioDto.languageVoices);
    }

    if (
      createScenarioDto.triggerWarningIds &&
      createScenarioDto.triggerWarningIds.length > 0
    ) {
      await this.validateTriggerWarnings(createScenarioDto.triggerWarningIds);
    }
    if (
      createScenarioDto.terminationEvents &&
      createScenarioDto.terminationEvents.length > 0
    ) {
      await this.validateTerminationEvents(createScenarioDto.terminationEvents);
    }
    if (createScenarioDto.behaviorInstructions) {
      await this.scenarioBehaviorInstructionService.validateBehaviorInstructionsBehaviors(
        createScenarioDto.behaviorInstructions,
      );
    }
    if (createScenarioDto.competencyId) {
      await this.competencyService.validateCompetencyId(
        createScenarioDto.competencyId,
      );
    }
    if (
      createScenarioDto.timerMode === true &&
      createScenarioDto.maxTimeValue
    ) {
      this.validateMaxTimeValue(createScenarioDto.maxTimeValue);
    }

    // Mirror the state validation in validateUpdateScenario so create and
    // update paths apply the same constraints (contiguous ranges, min gap
    // 50, finite bounds). The starting state is emergent (the range
    // containing 0), so there is no starting-state rule.
    if (
      Array.isArray(createScenarioDto.states) &&
      createScenarioDto.states.length > 0
    ) {
      const stateErrors = validateSimulationStates(createScenarioDto.states);
      if (stateErrors.length > 0) {
        throw new BadRequestException(
          `Invalid simulation states: ${stateErrors.join(' ')}`,
        );
      }
    }

    // Cross-check: when the scenario points at a hasStates main-agent
    // variant, states must be non-empty — otherwise the runtime renders
    // {state_x_guidelines} blank silently. Skip the lookup when no variant
    // is selected (default main agent doesn't use states).
    await this.validateStatesPairing(
      createScenarioDto.selectedMainPromptCode,
      createScenarioDto.states,
    );
  }

  /**
   * When a scenario selects a `hasStates: true` main-agent prompt, its
   * `states` array must contain at least one entry. Without this gate,
   * scenarios with selectedMainPromptCode set to a stateful variant but
   * empty states save successfully and silently render empty state
   * guidance at runtime.
   */
  private async validateStatesPairing(
    selectedMainPromptCode: string | undefined,
    states: unknown,
  ): Promise<void> {
    if (!selectedMainPromptCode) return;
    // PromptSharedService is the only cross-module accessor for prompt
    // rows from learn services; using it avoids a hard dependency on
    // PromptsRepository here.
    const matches = await this.promptSharedService.getPromptsByOptions({
      promptCode: [selectedMainPromptCode],
    });
    const selectedPrompt = matches?.[0];
    // Body-driven decision (shared with pruneStatesIfPromptNotStateful):
    // does the variant's body actually reference {state_x_guidelines}?
    // The legacy hasStates flag is consulted only for never-reconciled
    // rows, so duplicates whose admin removed the placeholder no longer
    // trigger the "must have states" requirement.
    const usesStates = selectedPrompt
      ? this.promptReferencesStates(selectedPrompt)
      : false;
    if (!usesStates) {
      this.logger.debug(
        `[STATES_VALIDATE] pairing ok — promptCode=${selectedMainPromptCode} ` +
          `does not reference {state_x_guidelines} (no states required)`,
      );
      return;
    }
    if (!Array.isArray(states) || states.length === 0) {
      this.logger.debug(
        `[STATES_VALIDATE] no states defined for promptCode=${selectedMainPromptCode} ` +
          `which references {state_x_guidelines} — allowed, states are optional`,
      );
      return;
    }
    this.logger.info(
      `[STATES_VALIDATE] pairing ok — promptCode=${selectedMainPromptCode} ` +
        `references {state_x_guidelines} statesCount=${(states as unknown[]).length}`,
    );
  }

  /**
   * Drop `states` from the dto when the selected main-agent prompt's
   * body does NOT reference `{state_x_guidelines}`. Prevents dormant
   * state data from a previous variant selection leaking into
   * `metadata.states` on a variant switch.
   *
   * Body-driven via auto-reconciled `availableVariables`, mirroring the
   * runtime gate in ai-learn (_get_selected_prompt_has_states) and the
   * UI gate in StatesEditor. Critically — does NOT consult the legacy
   * `hasStates` boolean column when the variant has a reconciled
   * variable list, because duplicates carry `hasStates=true` forever
   * (forced at duplicate time), so a hasStates-based check would never
   * trigger pruning for any duplicated variant whose admin later
   * removed `{state_x_guidelines}` from the body.
   *
   * Mutates the dto in place. Skips when no prompt is selected (we
   * can't determine the default's behaviour here without an extra
   * lookup, so we err on the side of preserving user input).
   */
  private async pruneStatesIfPromptNotStateful(dto: {
    selectedMainPromptCode?: string;
    states?: unknown;
  }): Promise<void> {
    if (!dto.selectedMainPromptCode) return;
    if (!Array.isArray(dto.states) || dto.states.length === 0) return;
    const matches = await this.promptSharedService.getPromptsByOptions({
      promptCode: [dto.selectedMainPromptCode],
    });
    const selectedPrompt = matches?.[0];
    if (!selectedPrompt) return; // unknown prompt — preserve user input

    const usesStates = this.promptReferencesStates(selectedPrompt);
    if (!usesStates) {
      const droppedCount = Array.isArray(dto.states) ? dto.states.length : 0;
      this.logger.info(
        `[STATES_VALIDATE] pruned ${droppedCount} dormant states — selected ` +
          `promptCode=${dto.selectedMainPromptCode} does not reference ` +
          `{state_x_guidelines} in its body`,
      );
      dto.states = undefined;
    }
  }

  /**
   * Body-driven check: does the variant's auto-reconciled
   * `availableVariables` list include `state_x_guidelines`? Falls back
   * to the legacy `hasStates` flag only when the list is empty / null
   * (i.e. the row predates auto-reconcile and has never been re-saved).
   *
   * Shared by pruneStatesIfPromptNotStateful and validateStatesPairing
   * so both decisions agree on whether a variant "uses states" today.
   */
  private promptReferencesStates(prompt: {
    availableVariables?: unknown;
    hasStates?: boolean | null;
  }): boolean {
    const list = Array.isArray(prompt.availableVariables)
      ? (prompt.availableVariables as Array<
          string | { name?: string; label?: string; required?: boolean }
        >)
      : [];
    if (list.length > 0) {
      return list.some((entry) => {
        const name = typeof entry === 'string' ? entry : entry?.name;
        return name === 'state_x_guidelines';
      });
    }
    // Empty / missing list → legacy row; honor the flag.
    return Boolean(prompt.hasStates);
  }

  private async validateTriggerWarnings(triggerWarningIds: string[]) {
    const uniqueTriggerWarningIds = [...new Set(triggerWarningIds)];
    const triggerWarnings =
      await this.triggerWarningsService.getTriggerWarningsByIds(
        uniqueTriggerWarningIds,
      );
    if (triggerWarnings.length !== uniqueTriggerWarningIds.length) {
      throw new BadRequestException('Invalid trigger warning IDs');
    }
  }

  private async validateTerminationEvents(
    terminationEvents: TerminationEventsDto[],
  ) {
    const uniqueTerminationEventIds = Array.from(
      new Set(terminationEvents.map((event) => event.id)),
    );
    if (uniqueTerminationEventIds.length !== terminationEvents.length) {
      throw new BadRequestException('Termination events must be unique');
    }
    // check if each termination event contains message and it should have some value in it
    const isTerminationEventMessageInvalid = terminationEvents.some(
      (event) => !event.message || event.message.trim()?.length === 0,
    );
    if (isTerminationEventMessageInvalid) {
      throw new BadRequestException('Termination event message is required');
    }
    const validEvents = await this.sessionEventSharedService.findByIds(
      uniqueTerminationEventIds,
    );
    if (validEvents.length !== uniqueTerminationEventIds.length) {
      throw new BadRequestException('Invalid termination event IDs');
    }
  }

  private validateScenarioStatus(
    data: CreateScenarioDto | UpdateScenarioDto,
  ): void {
    const { status, ...otherFields } = data;

    // Validate DRAFT: at least one field besides status must be provided
    if (status === ScenarioStatus.DRAFT) {
      const hasAtLeastOneField = Object.values(otherFields).some(
        (value) => value !== undefined && value !== null,
      );

      if (!hasAtLeastOneField) {
        throw new BadRequestException(
          'At least one field other than status must be provided for DRAFT scenario',
        );
      }
    }

    // Validate ACTIVE: all required fields must be present
    if (status === ScenarioStatus.ACTIVE) {
      const ACTIVE_SCENARIO_MANDATORY_FIELDS =
        getActiveScenarioMandatoryFields();
      const missingFields = ACTIVE_SCENARIO_MANDATORY_FIELDS.filter(
        (field) => !data[field as keyof typeof data],
      );

      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing for ACTIVE scenario: ${missingFields.join(', ')}`,
        );
      }

      // Behavior instructions are optional. Only validate structure when the
      // caller actually provided one or more entries — an empty array means
      // "no BI" and should be accepted, same as omitting the field entirely.
      if (data?.behaviorInstructions && data.behaviorInstructions.length > 0) {
        this.validateBehaviorInstructionsStructure(data.behaviorInstructions);
      }
    }
  }

  private validateBehaviorInstructionsStructure(
    behaviorInstructions: BehaviorInstructionDto[],
  ) {
    // Callers gate on non-empty input; this method only validates the structure
    // of each provided entry. The "BI required" check has been removed because
    // behavior instructions are now optional for ACTIVE scenarios.
    //
    // Per-state coaching (`stateInstructions`) is optional content, not a
    // gating field: newer prompt variants hide those columns entirely, and
    // AI-generated rows may reasonably omit them. Only category + at least
    // one linked behaviour drive scoring, so those are the only fields
    // required here.
    const invalidBehaviorInstructions = behaviorInstructions?.filter(
      (instruction) =>
        !instruction.category ||
        !instruction.behaviors ||
        instruction.behaviors.length === 0,
    );
    if (invalidBehaviorInstructions.length > 0) {
      this.logger.error(JSON.stringify(invalidBehaviorInstructions));
      throw new BadRequestException('Invalid behavior instructions');
    }
  }

  private validateMaxTimeValue(maxTimeValue: string): void {
    if (!maxTimeValue) {
      return;
    }

    if (!isValidTimeFormatHHMMSS(maxTimeValue)) {
      throw new BadRequestException(
        'Time value must be in format HH:MM:SS (e.g., 01:30:00)',
      );
    }

    // Parse time string to total seconds
    const timeInSeconds = parseTimeToSeconds(maxTimeValue);
    const minSeconds = parseTimeToSeconds(LOWER_MAX_TIMER_VALUE);
    const maxSeconds = parseTimeToSeconds(UPPER_MAX_TIMER_VALUE);

    if (timeInSeconds < minSeconds || timeInSeconds > maxSeconds) {
      throw new BadRequestException(
        `Time value must be between ${LOWER_MAX_TIMER_VALUE} and ${UPPER_MAX_TIMER_VALUE}`,
      );
    }
  }

  /**
   * For ACTIVE scenarios, linguisticStyleSamples must contain at least one
   * non-empty sample per active language in languageVoices. Deactivated
   * languages are skipped — the admin UI hides them, so samples can't be
   * provided for them and a stale languageVoices entry shouldn't block publish.
   */
  private async validateLinguisticStyleSamples(
    languageVoices?: Record<string, string>,
    linguisticStyleSamples?: Record<string, string[]>,
  ): Promise<void> {
    if (!languageVoices || Object.keys(languageVoices).length === 0) {
      return;
    }

    const languageIds = Object.entries(languageVoices)
      .filter(
        ([, voiceId]) =>
          typeof voiceId === 'string' && voiceId.trim().length > 0,
      )
      .map(([id]) => parseInt(id, 10))
      .filter((id) => !Number.isNaN(id));

    if (languageIds.length === 0) {
      return;
    }

    const activeLanguages =
      await this.sharedLanguageService.getLanguagesByIds(languageIds);

    const samples = linguisticStyleSamples ?? {};
    const missing: string[] = [];
    for (const lang of activeLanguages) {
      const langId = String(lang.id);
      const langSamples = samples[langId];
      const hasContent =
        Array.isArray(langSamples) &&
        langSamples.some((s) => typeof s === 'string' && s.trim().length > 0);
      if (!hasContent) {
        missing.push(lang.label);
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Linguistic style samples are required. ` +
          `Please provide at least one sample for: ${missing.join(', ')}`,
      );
    }
  }

  private async validateLanguageVoices(
    languageVoices: Record<string, string>,
  ): Promise<void> {
    const voiceIds = Array.from(
      new Set(
        Object.values(languageVoices).filter(
          (voiceId): voiceId is string =>
            typeof voiceId === 'string' && voiceId.trim().length > 0,
        ),
      ),
    );

    await executeInChunks(voiceIds, 10, async (voiceId) =>
      this.getScenarioVoice(voiceId),
    );
  }

  private async updateScenarioTerminationEvents(
    id: number,
    terminationEvents: TerminationEventsDto[],
    em: EntityManager,
  ) {
    const scenarioEventsRepo = em.getRepository(ScenarioEvents);
    const existingScenarioTerminationEvents = await scenarioEventsRepo.find({
      where: { scenarioId: id, autoTerminationStatus: true },
    });
    const terminationEventsToDelete = existingScenarioTerminationEvents.filter(
      (event) => !terminationEvents.some((te) => te.id === event.eventId),
    );
    if (terminationEventsToDelete.length > 0) {
      await scenarioEventsRepo.delete(
        terminationEventsToDelete.map((event) => event.id),
      );
      this.scenarioEventTranslationsRepository.delete({
        scenarioId: id,
        eventId: In(terminationEventsToDelete?.map((event) => event.eventId)),
      });
    }
    const terminationEventsToAdd = terminationEvents.filter(
      (event) =>
        !existingScenarioTerminationEvents.some(
          (te) => te.eventId === event.id,
        ),
    );
    if (terminationEventsToAdd.length > 0) {
      const newTerminationEvents = terminationEventsToAdd.map((event) =>
        scenarioEventsRepo.create({
          scenarioId: id,
          eventId: event.id,
          autoTerminationStatus: true,
          message: event.message,
        }),
      );
      await scenarioEventsRepo.save(newTerminationEvents);
      this.createUpdateScenarioEventsTranslations(
        terminationEventsToAdd?.map((event) => ({
          scenarioId: id,
          eventId: event.id,
          message: event.message,
        })),
      );
    }

    // Update the message of existing termination events
    const existingScenarioTerminationEventsToUpdate =
      existingScenarioTerminationEvents
        .filter((event) =>
          terminationEvents.some((te) => te.id === event.eventId),
        )
        ?.map((event) => {
          const updatedTerminationEvent = terminationEvents?.find(
            (te) => te.id === event.eventId,
          );
          return {
            ...event,
            message: updatedTerminationEvent?.message,
          };
        });
    if (existingScenarioTerminationEventsToUpdate.length > 0) {
      existingScenarioTerminationEventsToUpdate.forEach((event) =>
        scenarioEventsRepo.update(event.id, { message: event.message }),
      );
      this.createUpdateScenarioEventsTranslations(
        existingScenarioTerminationEventsToUpdate?.map((event) => ({
          scenarioId: id,
          eventId: event.id,
          message: event.message,
        })),
      );
    }
  }

  private async checkForInProgressScenarioReports(
    scenarioId: number,
  ): Promise<void> {
    await this.scenarioReportService.checkForInProgressScenarioReports(
      scenarioId,
      'Cannot update scenario while a report is in progress',
    );
  }

  async updateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
    userId: number,
    // When provided, the update runs inside the caller's transaction (used by
    // publishVersion to make config + events + version-status atomic) instead
    // of opening its own. Omitted on the normal edit path — behaviour is
    // unchanged there.
    manager?: EntityManager,
  ): Promise<boolean> {
    // Drop stale states data BEFORE validation runs. The previous order
    // (validate → prune) rejected updates whenever a variant whose body
    // used to include {state_x_guidelines} had its placeholder removed
    // — the orphaned states (often with legacy null bounds) failed the
    // strict-bounds validator before pruning got a chance to clear
    // them. With body-driven pruning + this reorder, the dto reaches
    // the validator already cleaned.
    await this.pruneStatesIfPromptNotStateful(updateScenarioDto);

    const scenario = await this.validateUpdateScenario(id, updateScenarioDto);

    // Roleplay Studio v2 shells are materialised from a versioned spec — the
    // v1 studio's fan-out must never touch them, or the next spec publish
    // would silently clobber the edit. Author through the roleplay-studio
    // endpoints instead.
    if (scenario.engine === ScenarioEngine.ROLEPLAY_V2) {
      throw new UnprocessableEntityException(
        'This scenario is managed by Roleplay Studio v2; edit its roleplay spec instead.',
      );
    }

    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    if (isMultiTenantAdmin && scenario.createdBy !== userId) {
      throw new ForbiddenException('You can only edit your own roleplays');
    }

    await this.checkForInProgressScenarioReports(scenario.id);

    try {
      const runUpdate = async (
        entityManager: EntityManager,
      ): Promise<boolean> => {
        const updateData = mapUpdateScenarioRequestToEntity(
          updateScenarioDto,
          scenario,
          userId,
        );

        const scenarioRepository = entityManager.getRepository(Scenarios);
        const updated = await scenarioRepository.update(id, updateData);
        if (scenario.status == ScenarioStatus.ACTIVE) {
          const translationConsiderableData: TranslationConsiderableData = {
            currentLocation: scenario.metadata?.currentLocation,
            profession: scenario.metadata?.profession,
            context: scenario.metadata?.context,
            age: scenario.metadata?.age,
            gender: scenario.metadata?.gender,
          };
          this.persistTranslationsForScenarios(
            [scenario], // single-item array so helper can reuse same logic
            () =>
              this.sanitizeMetadata({
                title: updateScenarioDto.title,
                description: updateScenarioDto.description,
                sexualOrientation: updateScenarioDto.sexualOrientation,
                genderIdentity: updateScenarioDto.genderIdentity,
                customFields: updateScenarioDto?.customFields,
                knowledgeSources: updateScenarioDto?.knowledgeSources,
                stateNames: updateScenarioDto?.stateNames,
              }),
            translationConsiderableData,
            (s) =>
              updateScenarioDto.languageVoices ?? s.metadata?.languageVoices,
            {
              userId,
              jobId: randomUUID(),
              action: ScenarioTranslationAction.UPDATE,
            },
          );
        }
        await this.updateScenarioTerminationEvents(
          id,
          updateScenarioDto?.terminationEvents || [],
          entityManager,
        );

        // Update behavior instructions when the caller explicitly sent an
        // array (including `[]`, which means "remove all existing BIs").
        // An omitted field (undefined) means "no change to BIs"; the
        // updateBehaviorInstructions service does a full sync — creating,
        // updating, and soft-deleting as needed.
        if (Array.isArray(updateScenarioDto.behaviorInstructions)) {
          await this.scenarioBehaviorInstructionService.updateBehaviorInstructions(
            {
              scenarioId: id,
              behaviorInstructions: updateScenarioDto.behaviorInstructions,
            },
            entityManager,
          );
        }

        if (updated.affected === 0) return false;

        const updatedScenario = await scenarioRepository.findOne({
          where: { id },
        });
        if (
          updateScenarioDto.isGlobal !== undefined &&
          updatedScenario?.isGlobal !== scenario.isGlobal
        ) {
          const tenants = await this.tenantService.findAll();
          const tenantIds = tenants.map((tenant) => tenant.id);
          const scenarioTenantRepo =
            entityManager.getRepository(ScenarioTenants);

          if (updateScenarioDto.isGlobal) {
            await scenarioTenantRepo.delete({ scenarioId: id });
            const scenarioTenantMappings = tenantIds.map((tenantId) => ({
              scenarioId: id,
              tenantId: tenantId,
            }));
            await scenarioTenantRepo.save(
              scenarioTenantRepo.create(scenarioTenantMappings),
            );
          } else {
            await scenarioTenantRepo.delete({
              scenarioId: id,
              tenantId: In(tenantIds),
            });
          }
        }
        const scenarioTriggerWarningsRepo = entityManager.getRepository(
          ScenarioTriggerWarnings,
        );
        const existingTriggerWarnings = await scenarioTriggerWarningsRepo.find({
          where: { scenarioId: id },
        });
        const existingTriggerWarningIds = existingTriggerWarnings?.map(
          (warning) => warning.triggerWarningId,
        );
        // Getting triggerWarnings that need to be added
        const newTriggerWarningIds = [
          ...new Set(
            !existingTriggerWarningIds
              ? updateScenarioDto?.triggerWarningIds
              : updateScenarioDto?.triggerWarningIds?.filter(
                  (id) => !existingTriggerWarningIds?.includes(id),
                ),
          ),
        ];
        if (newTriggerWarningIds && newTriggerWarningIds.length > 0) {
          const scenarioTriggerWarningList = newTriggerWarningIds.map(
            (triggerWarningId) =>
              scenarioTriggerWarningsRepo.create({
                scenarioId: id,
                triggerWarningId,
              }),
          );
          await scenarioTriggerWarningsRepo.save(scenarioTriggerWarningList);
        }

        // Getting triggerWranings that need to be deleted
        const triggerWarningListToDelete = existingTriggerWarnings
          ?.filter(
            ({ triggerWarningId }) =>
              !updateScenarioDto.triggerWarningIds?.includes(triggerWarningId),
          )
          ?.map(({ id }) => id);
        if (triggerWarningListToDelete.length > 0) {
          await scenarioTriggerWarningsRepo.delete(triggerWarningListToDelete);
        }

        if (isMultiTenantAdmin) {
          this.auditLogService.log({
            eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_EDITED_SCENARIO,
            details: {
              action: AUDIT_ACTIONS.UPDATE_SCENARIO,
              scenarioId: id,
              userId,
            },
          });
        }

        return true;
      };
      const success = manager
        ? await runUpdate(manager)
        : await this.dataSource.transaction(runUpdate);

      if (
        success &&
        (updateScenarioDto.translationOpeningStatements !== undefined ||
          updateScenarioDto.translationDescription !== undefined ||
          updateScenarioDto.translationTitle !== undefined ||
          updateScenarioDto.translationReminders !== undefined)
      ) {
        const fresh = await this.scenariosRepository.findOne({
          where: { id },
        });
        if (updateScenarioDto.translationOpeningStatements !== undefined) {
          await this.upsertTranslationOpeningStatements(
            id,
            updateScenarioDto.translationOpeningStatements,
            fresh?.metadata,
          );
        }
        if (updateScenarioDto.translationDescription !== undefined) {
          await this.upsertTranslationDescription(
            id,
            updateScenarioDto.translationDescription,
            fresh?.metadata,
          );
        }
        if (updateScenarioDto.translationTitle !== undefined) {
          await this.upsertTranslationTitle(
            id,
            updateScenarioDto.translationTitle,
            fresh?.metadata,
          );
        }
        if (updateScenarioDto.translationReminders !== undefined) {
          await this.upsertTranslationReminders(
            id,
            updateScenarioDto.translationReminders,
            fresh?.metadata,
          );
        }
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to update scenario with error ${JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `Failed to update scenario: ${error.message}`,
      );
    }
  }

  async duplicateScenario(
    id: number,
    currentUser?: TokenUser,
  ): Promise<Scenarios> {
    const scenario = await this.getAdminScenario(id, currentUser);

    const scenarioEvents = await this.scenarioEventsRepository.find({
      where: { scenarioId: id },
    });

    const triggerWarnings =
      await this.triggerWarningsService.getTriggerWarningsByScenarioId(id);

    // Get behavior instructions from the original scenario
    const originalBehaviorInstructions =
      await this.scenarioSharedService.getBehaviorInstructionsByScenarioId(id);

    const newScenario = {
      title: `Copy of ${scenario.title}`,
      description: scenario.description,
      coverImageUrl: scenario.coverImageUrl,
      coverVideoUrl: scenario.coverVideoUrl,
      status: ScenarioStatus.DRAFT,
      isPublic: scenario.isPublic,
      prompt: scenario.prompt,
      metadata: scenario.metadata,
      isGlobal: scenario.isGlobal,
      scenario: scenario.scenario,
      competencyId: scenario.competencyId, // Copy competency from original scenario
      category: scenario.category,
      partnerOrgName: scenario.partnerOrgName,
      createdBy: Number(ExecutionManager.getUserId()),
      updatedBy: Number(ExecutionManager.getUserId()),
    };

    return await this.dataSource.transaction(async (manager) => {
      const scenarioRepo = manager.getRepository(Scenarios);
      const scenarioEventRepo = manager.getRepository(ScenarioEvents);
      const triggerWarningsScenarioRepo = manager.getRepository(
        ScenarioTriggerWarnings,
      );

      const newScenarioData = await scenarioRepo.save(newScenario);

      if (scenarioEvents.length > 0) {
        const newScenarioEvents = scenarioEvents.map((item) =>
          scenarioEventRepo.create({
            scenarioId: newScenarioData.id,
            autoTerminationStatus: item.autoTerminationStatus,
            branchingStatus: item.branchingStatus,
            branchInstruction: item.branchInstruction,
            emoji: item.emoji,
            eventId: item.eventId,
            feedbackStatus: item.feedbackStatus,
            message: item.message,
            score: item.score,
          }),
        );
        await scenarioEventRepo.save(newScenarioEvents);
      }

      if (triggerWarnings.length > 0) {
        const newScenarioTriggerWarnings = triggerWarnings.map((item) =>
          triggerWarningsScenarioRepo.create({
            scenarioId: newScenarioData.id,
            triggerWarningId: item.triggerWarningId,
          }),
        );
        await triggerWarningsScenarioRepo.save(newScenarioTriggerWarnings);
      }

      if (newScenarioData.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantIds = tenants.map((tenant) => tenant.id);
        const scenarioTenantRepo = manager.getRepository(ScenarioTenants);
        const scenarioTenants = tenantIds.map((tenantId) =>
          scenarioTenantRepo.create({
            scenarioId: newScenarioData.id,
            tenantId,
          }),
        );
        await scenarioTenantRepo.save(scenarioTenants);
      }

      // Copy behavior instructions from the original scenario
      if (
        originalBehaviorInstructions &&
        originalBehaviorInstructions.length > 0
      ) {
        const behaviorInstructionsToCreate = originalBehaviorInstructions.map(
          (instruction) => ({
            category: instruction.category,
            stateInstructions: instruction.stateInstructions,
            behaviors: instruction.behaviors.map((behavior) => behavior.id),
          }),
        );

        await this.scenarioBehaviorInstructionService.createBehaviorInstructions(
          [
            {
              scenarioId: newScenarioData.id,
              behaviorInstructions: behaviorInstructionsToCreate,
            },
          ],
          manager,
        );
      }

      if (currentUser?.id) {
        const isMultiTenantAdmin =
          await this.permissionsService.isMultiTenantAdmin(currentUser.id);
        if (isMultiTenantAdmin) {
          this.auditLogService.log({
            eventType: AUDIT_EVENTS.MULTI_TENANT_ADMIN_EDITED_SCENARIO,
            details: {
              action: AUDIT_ACTIONS.DUPLICATE_SCENARIO,
              originalScenarioId: id,
              newScenarioId: newScenarioData.id,
            },
          });
        }
      }

      this.logger.info(`Scenario ${id} duplicated successfully`);
      return newScenarioData;
    });
  }

  async validateUpdateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
  ): Promise<Scenarios> {
    const scenario = await this.scenariosRepository.findOne({ where: { id } });
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    // States schema validation runs whenever a non-empty `states` array is
    // present in the payload. Empty / unset is allowed at the schema level
    // — pairing with a hasStates prompt is gated by validateStatesPairing
    // below.
    if (
      Array.isArray(updateScenarioDto.states) &&
      updateScenarioDto.states.length > 0
    ) {
      const stateErrors = validateSimulationStates(updateScenarioDto.states);
      if (stateErrors.length > 0) {
        throw new BadRequestException(
          `Invalid simulation states: ${stateErrors.join(' ')}`,
        );
      }
    }

    // Cross-check pairing: if the (possibly newly-selected) main-agent
    // variant has hasStates=true, the simulation must carry a non-empty
    // states array. Use the incoming selectedMainPromptCode when set,
    // else fall back to whatever was already on the scenario.
    const effectiveCode =
      updateScenarioDto.selectedMainPromptCode !== undefined
        ? updateScenarioDto.selectedMainPromptCode
        : (scenario.metadata as { selectedMainPromptCode?: string } | undefined)
            ?.selectedMainPromptCode;
    const effectiveStates =
      updateScenarioDto.states !== undefined
        ? updateScenarioDto.states
        : (scenario.metadata as { states?: unknown } | undefined)?.states;
    await this.validateStatesPairing(effectiveCode, effectiveStates);

    if (
      updateScenarioDto?.status &&
      updateScenarioDto.status !== scenario.status &&
      (updateScenarioDto.status === ScenarioStatus.DRAFT ||
        updateScenarioDto.status === ScenarioStatus.ARCHIVED)
    ) {
      const scenarioPathItem =
        await this.scenarioPathSharedService.getScenarioPathItemByScenarioId(
          id,
        );
      if (scenarioPathItem) {
        throw new BadRequestException(
          'This simulation is part of a Simulation Pathway and can’t be moved to draft. Please publish the changes.',
        );
      }

      const caseItem = await this.caseSharedService.getCaseItemByScenarioId(id);
      if (caseItem) {
        throw new BadRequestException(
          'This simulation is part of a Case and can’t be moved to draft. Please publish the changes.',
        );
      }
    }

    if (updateScenarioDto.status) {
      if (
        !SCENARIO_STATUS_MAP.get(scenario.status)?.includes(
          updateScenarioDto.status,
        )
      ) {
        throw new BadRequestException(
          `Unable to update status from ${scenario.status} to ${updateScenarioDto.status}`,
        );
      }
      await this.validateScenarioStatus(updateScenarioDto);
    }

    if (updateScenarioDto.languageVoices) {
      await this.validateLanguageVoices(updateScenarioDto.languageVoices);
    }

    if (
      updateScenarioDto.triggerWarningIds &&
      updateScenarioDto.triggerWarningIds.length > 0
    ) {
      await this.validateTriggerWarnings(updateScenarioDto.triggerWarningIds);
    }

    if (
      updateScenarioDto?.terminationEvents &&
      updateScenarioDto?.terminationEvents?.length > 0
    ) {
      await this.validateTerminationEvents(updateScenarioDto.terminationEvents);
    }

    if (updateScenarioDto.behaviorInstructions) {
      await this.scenarioBehaviorInstructionService.validateBehaviorInstructionsBehaviors(
        updateScenarioDto.behaviorInstructions,
      );
    }
    if (updateScenarioDto.competencyId) {
      await this.competencyService.validateCompetencyId(
        updateScenarioDto.competencyId,
      );
    }
    if (
      updateScenarioDto.timerMode === true &&
      updateScenarioDto.maxTimeValue
    ) {
      this.validateMaxTimeValue(updateScenarioDto.maxTimeValue);
    }

    return scenario;
  }

  async deleteAdminScenario(
    id: number,
    currentUser?: TokenUser,
  ): Promise<boolean> {
    // To check if the scenario exists
    await this.getAdminScenario(id, currentUser);

    const scenarioPathItem =
      await this.scenarioPathSharedService.getScenarioPathItemByScenarioId(id);
    if (scenarioPathItem) {
      throw new BadRequestException(
        'This simulation cannot be deleted as it is part of a Simulation Pathway',
      );
    }

    const caseItem = await this.caseSharedService.getCaseItemByScenarioId(id);
    if (caseItem) {
      throw new BadRequestException(
        'This simulation cannot be deleted as it is part of a Case',
      );
    }
    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Scenarios).softDelete(id);
      await em.getRepository(ScenarioEvents).softDelete({ scenarioId: id });
      await em.getRepository(ScenarioTenants).softDelete({ scenarioId: id });
      await em.getRepository(ScenarioTriggerWarnings).delete({
        scenarioId: id,
      });
    });
    return true;
  }

  async mapEventsToScenario(
    createScenarioEventsDto: CreateScenarioEventsDto,
    // When provided, runs inside the caller's transaction (publishVersion).
    manager?: EntityManager,
  ) {
    const { scenarioId, events } = createScenarioEventsDto;

    await this.validateMapEventsToScenario(scenarioId, events);
    await this.checkForInProgressScenarioReports(scenarioId);

    try {
      const runMap = async (entityManager: EntityManager) => {
        const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);

        // Create an array of ScenarioEvents entities to be saved
        const scenarioEvents = await executeInChunks(
          events,
          10,
          async (event) => {
            const scenarioEvent = await scenarioEventsRepo.findOne({
              where: {
                scenarioId,
                eventId: event.id,
                autoTerminationStatus: false,
              },
            });

            return {
              ...scenarioEvent,
              scenarioId,
              eventId: event.id,
              autoTerminationStatus: false,
              score: event.score ?? scenarioEvent?.score,
              ...(event.feedbackStatus
                ? {
                    feedbackStatus: event.feedbackStatus,
                    emoji: event.emoji,
                    message: event.message,
                  }
                : {
                    feedbackStatus: false,
                    emoji: undefined,
                    message: undefined,
                  }),
              ...(event.branchingStatus
                ? {
                    branchingStatus: event.branchingStatus,
                    branchInstruction: event.branchInstruction,
                  }
                : {
                    branchingStatus: false,
                    branchInstruction: undefined,
                  }),
              detectionConfig:
                event.detectionConfig ?? scenarioEvent?.detectionConfig,
              checklistVisibilityStatus: event.checklistVisibilityStatus,
            };
          },
        );

        await scenarioEventsRepo.save(scenarioEvents);

        this.createUpdateScenarioEventsTranslations(scenarioEvents);

        return {
          scenarioId,
          events: scenarioEvents.map((event) => ({
            id: event.eventId,
            feedbackStatus: event.feedbackStatus,
            score: event.score,
            emoji: event.emoji,
            message: event.message,
            branchingStatus: event.branchingStatus,
            branchInstruction: event.branchInstruction,
            detectionConfig: event.detectionConfig,
            checklistVisibilityStatus: event.checklistVisibilityStatus,
          })),
        };
      };
      return manager
        ? await runMap(manager)
        : await this.dataSource.transaction(runMap);
    } catch (error) {
      if (
        isDuplicateKeyException(
          error,
          'uq_scenario_events_scenario_id_event_id_auto_term_status_idx',
        )
      ) {
        throw new BadRequestException('Event already exists in scenario');
      }
      this.logger.error(`Error mapping events to scenario: ${error}`);
      throw error;
    }
  }

  private async validateMapEventsToScenario(
    scenarioId: number,
    events: EventMappingDto[],
  ) {
    if (events.length === 0) {
      throw new BadRequestException('Events array cannot be empty');
    }

    const eventIds = events.map((event) => event.id);

    await this.getScenario(scenarioId);
    // Validate events exist
    const validEvents =
      await this.sessionEventSharedService.findByIds(eventIds);
    const validIdsSet = new Set(validEvents.map((e) => e.id));
    const invalidEventIds = eventIds.filter((id) => !validIdsSet.has(id));
    if (invalidEventIds.length > 0) {
      throw new BadRequestException(`Invalid event IDs: ${invalidEventIds}`);
    }

    for (const event of events) {
      if (event.detectionConfig?.startTime === null) {
        throw new BadRequestException('Start time cannot be null');
      }

      if (
        event.detectionConfig?.startTime &&
        event.detectionConfig?.endTime &&
        event.detectionConfig?.startTime > event.detectionConfig?.endTime
      ) {
        throw new BadRequestException(
          'Start time cannot be greater than end time',
        );
      }

      if (
        event.detectionConfig?.minGapTime &&
        event.detectionConfig?.minGapTime < 0
      ) {
        throw new BadRequestException('Minimum gap time cannot be less than 0');
      }

      if (
        event.detectionConfig?.maxOccurrences &&
        event.detectionConfig?.maxOccurrences < 0
      ) {
        throw new BadRequestException(
          'Maximum occurrences cannot be less than 0',
        );
      }

      if (
        event.detectionConfig?.minScore &&
        event.detectionConfig?.maxScore &&
        event.detectionConfig?.minScore > event.detectionConfig?.maxScore
      ) {
        throw new BadRequestException(
          'Minimum score cannot be greater than maximum score',
        );
      }

      if (
        event.detectionConfig?.occurrenceInterval &&
        event.detectionConfig?.occurrenceInterval < 1
      ) {
        throw new BadRequestException(
          'Occurrence interval should be at least 1',
        );
      }
    }
  }

  async deleteScenarioEvents(
    scenarioEvents: DeleteScenarioEventsDto,
    // When provided, deletes within the caller's transaction (publishVersion).
    manager?: EntityManager,
  ) {
    const { scenarioId, eventIds } = scenarioEvents;
    if (eventIds.length === 0) {
      throw new BadRequestException('Event IDs array cannot be empty');
    }

    await this.getScenario(scenarioId);
    await this.checkForInProgressScenarioReports(scenarioId);

    const eventsRepo = manager
      ? manager.getRepository(ScenarioEvents)
      : this.scenarioEventsRepository;
    const result = await eventsRepo.delete({
      eventId: In(eventIds),
      scenarioId,
      autoTerminationStatus: false,
    });

    if (result.affected === 0) {
      throw new BadRequestException('No scenario events found to delete');
    }
    return result.affected;
  }

  async getScenarioVoices(
    searchName: string | undefined,
    providers: string | undefined,
    languageIds: string | undefined,
    options: Pagination,
  ): Promise<ScenarioVoices[]> {
    return this.scenarioVoiceRepository.getScenarioVoices(
      searchName,
      providers,
      languageIds,
      options,
    );
  }

  async getScenarioVoice(id: string): Promise<ScenarioVoices> {
    return this.scenarioSharedService.getScenarioVoice(id);
  }

  async createScenarioVoices(
    createScenarioVoicesDto: CreateScenarioVoicesDto,
  ): Promise<ScenarioVoices[]> {
    const scenarioVoices = this.scenarioVoiceRepository.create(
      createScenarioVoicesDto.voices,
    );
    return this.scenarioVoiceRepository.save(scenarioVoices);
  }

  async updateScenarioVoice(
    id: string,
    updateScenarioVoiceDto: UpdateScenarioVoiceDto,
  ): Promise<boolean> {
    const scenarioVoice = await this.scenarioVoiceRepository.findOne({
      where: { id },
    });

    if (!scenarioVoice) {
      throw new NotFoundException('Scenario voice not found');
    }

    const updated = await this.scenarioVoiceRepository.update(
      id,
      updateScenarioVoiceDto as DeepPartial<ScenarioVoices>,
    );

    return updated.affected !== 0;
  }

  async getScenarioVoiceLanguagesForAdmin(
    active?: boolean,
    voicesNeeded?: boolean,
  ) {
    return this.scenarioVoiceRepository.getLanguagesWithVoices(
      active,
      voicesNeeded,
    );
  }

  async getLanguagesForScenario(active?: boolean, hasVoices?: boolean) {
    return this.scenarioVoiceRepository.getLanguagesForScenario(
      active,
      hasVoices,
    );
  }

  /**
   * Sanitize metadata for a `jsonb` column.
   *
   * Delegates to the shared `sanitizeJsonbMetadata` helper which:
   *   - drops null / undefined / empty-string top-level values,
   *   - trims top-level strings,
   *   - recursively strips C0 control bytes (NULL, etc.) from strings,
   *     INCLUDING strings buried inside arrays / nested objects.
   *
   * The nested cleanup is the critical bit: a stray NULL byte anywhere
   * in `metadata.openingStatements[i]` would otherwise fail the
   * `scenario_translations` insert with Postgres 22P05 ("  cannot
   * be converted to text") — the issue this method now defends against.
   *
   * Kept as a thin instance method (instead of inlining the util at
   * each call site) to preserve the existing test seam — spec files
   * stub `(service as any).sanitizeMetadata` and we don't want to
   * churn those.
   */
  private sanitizeMetadata<T extends Record<string, any>>(
    metadata: T,
  ): Partial<T> {
    return sanitizeJsonbMetadata(metadata);
  }

  /**
   * Build translated metadata map for a list of language codes.
   * Returns an object: { [langCode]: Partial<MetadataShape> }
   * Uses OpenAI for Indian languages (natural code-mixing)
   * Falls back to Google Translate for other languages
   */
  private async buildTranslatedMetadataForLanguageCodes(
    metadataObj:
      | Partial<MetadataShape>
      | Partial<{ message: string; branchInstruction: string }>,
    languageCodes: string[],
    translationConsiderableData?: TranslationConsiderableData,
    onProgress?: TranslationProgressCallback,
  ): Promise<Record<string, Partial<MetadataShape>>> {
    // validation
    const codes = (languageCodes ?? [])
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter(Boolean);
    if (!codes.length) {
      this.logger?.debug?.(
        '[buildTranslatedMetadataForLanguageCodes] no language codes provided',
      );
      return {};
    }
    if (!metadataObj || Object.keys(metadataObj).length === 0) {
      this.logger?.debug?.(
        '[buildTranslatedMetadataForLanguageCodes] no metadata to translate',
      );
      return {};
    }

    // Delegate to external translations service. It should itself validate/truncate and handle retries.
    // Expect translateObjectToLanguages to accept a sanitized metadata object and array of codes.
    try {
      const openaiTranslatedVersion =
        await this.openaiTranslationsService.translateScenarioData(
          metadataObj,
          codes,
          translationConsiderableData,
          onProgress,
        );

      if (
        openaiTranslatedVersion &&
        Object.keys(openaiTranslatedVersion).length > 0
      ) {
        this.logger?.debug?.(
          '[buildTranslatedMetadataForLanguageCodes] successfully translated using OpenAI',
        );
        return openaiTranslatedVersion;
      }

      this.logger?.debug?.(
        '[buildTranslatedMetadataForLanguageCodes] OpenAI translation returned empty, falling back to Google Translate',
      );

      const translated =
        await this.googleTranslationsService.translateObjectToLanguages(
          metadataObj,
          codes,
          { mimeType: 'text/html' },
        );

      // Expect translated to be a map { langCode: { tone: '...', ... } }
      return translated ?? {};
    } catch (err) {
      this.logger?.error?.(
        '[buildTranslatedMetadataForLanguageCodes] translation call failed',
        { err, languageCodes: codes },
      );
      // bubble up or return empty map to continue processing other languages
      return {};
    }
  }

  private hasTranslatableFieldsChanged(
    scenario: Scenarios,
    sanitized: Partial<MetadataShape>,
  ): boolean {
    const isCreateOrNew =
      !scenario.translations || Object.keys(scenario.translations).length === 0;

    if (isCreateOrNew) {
      return true;
    }

    for (const [key, newValue] of Object.entries(sanitized)) {
      let oldValue: any;
      if (
        key === SCENARIO_FIELDS.TITLE ||
        key === SCENARIO_FIELDS.DESCRIPTION
      ) {
        oldValue = (scenario as any)[key];
      } else {
        oldValue = scenario.metadata?.[key];
      }

      if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        return true;
      }
    }
    return false;
  }

  private async upsertTranslationDescription(
    scenarioId: number,
    translationDescription: Record<string, string>,
    metadataForPrimaryResolution?: Record<string, any> | null,
  ): Promise<void> {
    const primaryId =
      await this.scenarioSharedService.resolveOpeningDialoguePrimaryLanguageId(
        metadataForPrimaryResolution,
      );

    const existing =
      await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
        scenarioId,
      );

    const toCreate: CreateScenarioTranslation[] = [];
    const toUpdate: UpdateScenarioTranslation[] = [];
    const normalizedByLanguageId: Record<number, string> = {};

    for (const [langIdStr, raw] of Object.entries(translationDescription)) {
      const languageId = Number(langIdStr);
      if (!Number.isFinite(languageId)) continue;
      if (primaryId != null && languageId === primaryId) continue;

      const row = existing?.find((r) => Number(r.languageId) === languageId);
      const normalized = typeof raw === 'string' ? raw.trim() : '';
      normalizedByLanguageId[languageId] = normalized;

      const mergedMetadata = {
        ...(row?.metadata ?? {}),
        description: normalized,
      };

      if (row) {
        toUpdate.push({ scenarioId, languageId, metadata: mergedMetadata });
      } else {
        toCreate.push({ scenarioId, languageId, metadata: mergedMetadata });
      }
    }

    if (toCreate.length) {
      await this.scenarioTranslationsRepository.createScenarioTranslations(
        toCreate,
      );
    }
    if (toUpdate.length) {
      await this.scenarioTranslationsRepository.updateScenarioTranslations(
        toUpdate,
      );
    }

    // Mirror description translations into scenarios.translations JSONB keyed
    // by translationCode so applyScenarioTranslations() can resolve by the
    // app's language code at read time. The side table (keyed by languageId)
    // and this JSONB (keyed by code) must stay in sync.
    const touchedLanguageIds = Object.keys(normalizedByLanguageId).map(Number);
    if (touchedLanguageIds.length) {
      const languages =
        await this.sharedLanguageService.getLanguagesByIds(touchedLanguageIds);
      if (languages.length) {
        const scenario = await this.scenariosRepository.findOne({
          where: { id: scenarioId },
        });
        const currentTranslations: Record<string, any> =
          (scenario?.translations as Record<string, any>) || {};
        const mergedTranslations: Record<string, any> = {
          ...currentTranslations,
        };
        for (const language of languages) {
          const code = language.translationCode?.trim();
          if (!code) continue;
          mergedTranslations[code] = {
            ...(currentTranslations[code] || {}),
            description: normalizedByLanguageId[Number(language.id)],
          };
        }
        await this.dataSource
          .getRepository(Scenarios)
          .update(scenarioId, { translations: mergedTranslations });
      }
    }
  }

  private async upsertTranslationTitle(
    scenarioId: number,
    translationTitle: Record<string, string>,
    metadataForPrimaryResolution?: Record<string, any> | null,
  ): Promise<void> {
    const primaryId =
      await this.scenarioSharedService.resolveOpeningDialoguePrimaryLanguageId(
        metadataForPrimaryResolution,
      );

    const existing =
      await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
        scenarioId,
      );

    const toCreate: CreateScenarioTranslation[] = [];
    const toUpdate: UpdateScenarioTranslation[] = [];
    const normalizedByLanguageId: Record<number, string> = {};

    for (const [langIdStr, raw] of Object.entries(translationTitle)) {
      const languageId = Number(langIdStr);
      if (!Number.isFinite(languageId)) continue;
      if (primaryId != null && languageId === primaryId) continue;

      const row = existing?.find((r) => Number(r.languageId) === languageId);
      const normalized = typeof raw === 'string' ? raw.trim() : '';
      normalizedByLanguageId[languageId] = normalized;

      const mergedMetadata = {
        ...(row?.metadata ?? {}),
        title: normalized,
      };

      if (row) {
        toUpdate.push({ scenarioId, languageId, metadata: mergedMetadata });
      } else {
        toCreate.push({ scenarioId, languageId, metadata: mergedMetadata });
      }
    }

    if (toCreate.length) {
      await this.scenarioTranslationsRepository.createScenarioTranslations(
        toCreate,
      );
    }
    if (toUpdate.length) {
      await this.scenarioTranslationsRepository.updateScenarioTranslations(
        toUpdate,
      );
    }

    // Mirror title translations into scenarios.translations JSONB keyed by
    // translationCode so applyScenarioTranslations() (and the session read
    // paths) can resolve by the app's language code at read time.
    const touchedLanguageIds = Object.keys(normalizedByLanguageId).map(Number);
    if (touchedLanguageIds.length) {
      const languages =
        await this.sharedLanguageService.getLanguagesByIds(touchedLanguageIds);
      if (languages.length) {
        const scenario = await this.scenariosRepository.findOne({
          where: { id: scenarioId },
        });
        const currentTranslations: Record<string, any> =
          (scenario?.translations as Record<string, any>) || {};
        const mergedTranslations: Record<string, any> = {
          ...currentTranslations,
        };
        for (const language of languages) {
          const code = language.translationCode?.trim();
          if (!code) continue;
          mergedTranslations[code] = {
            ...(currentTranslations[code] || {}),
            title: normalizedByLanguageId[Number(language.id)],
          };
        }
        await this.dataSource
          .getRepository(Scenarios)
          .update(scenarioId, { translations: mergedTranslations });
      }
    }
  }

  private async upsertTranslationReminders(
    scenarioId: number,
    translationReminders: Record<string, string[]>,
    metadataForPrimaryResolution?: Record<string, any> | null,
  ): Promise<void> {
    const primaryId =
      await this.scenarioSharedService.resolveOpeningDialoguePrimaryLanguageId(
        metadataForPrimaryResolution,
      );

    const existing =
      await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
        scenarioId,
      );

    const toCreate: CreateScenarioTranslation[] = [];
    const toUpdate: UpdateScenarioTranslation[] = [];
    const normalizedByLanguageId: Record<number, string[]> = {};

    for (const [langIdStr, lines] of Object.entries(translationReminders)) {
      const languageId = Number(langIdStr);
      if (!Number.isFinite(languageId)) continue;
      if (primaryId != null && languageId === primaryId) continue;

      const row = existing?.find((r) => Number(r.languageId) === languageId);
      const normalizedLines = Array.isArray(lines)
        ? lines.map((l) => String(l).trim()).filter((l) => l.length > 0)
        : [];
      normalizedByLanguageId[languageId] = normalizedLines;

      const mergedMetadata = {
        ...(row?.metadata ?? {}),
        reminders: normalizedLines,
      };

      if (row) {
        toUpdate.push({ scenarioId, languageId, metadata: mergedMetadata });
      } else {
        toCreate.push({ scenarioId, languageId, metadata: mergedMetadata });
      }
    }

    if (toCreate.length) {
      await this.scenarioTranslationsRepository.createScenarioTranslations(
        toCreate,
      );
    }
    if (toUpdate.length) {
      await this.scenarioTranslationsRepository.updateScenarioTranslations(
        toUpdate,
      );
    }

    // Mirror reminders translations into scenarios.translations JSONB keyed
    // by translationCode — reminders are shown live during a session (unlike
    // openingStatements, which are admin/prompt-only), so the session-start
    // read path needs the same code-keyed lookup as description/title.
    const touchedLanguageIds = Object.keys(normalizedByLanguageId).map(Number);
    if (touchedLanguageIds.length) {
      const languages =
        await this.sharedLanguageService.getLanguagesByIds(touchedLanguageIds);
      if (languages.length) {
        const scenario = await this.scenariosRepository.findOne({
          where: { id: scenarioId },
        });
        const currentTranslations: Record<string, any> =
          (scenario?.translations as Record<string, any>) || {};
        const mergedTranslations: Record<string, any> = {
          ...currentTranslations,
        };
        for (const language of languages) {
          const code = language.translationCode?.trim();
          if (!code) continue;
          mergedTranslations[code] = {
            ...(currentTranslations[code] || {}),
            reminders: normalizedByLanguageId[Number(language.id)],
          };
        }
        await this.dataSource
          .getRepository(Scenarios)
          .update(scenarioId, { translations: mergedTranslations });
      }
    }
  }

  private async upsertTranslationOpeningStatements(
    scenarioId: number,
    translationOpeningStatements: Record<string, string[]>,
    metadataForPrimaryResolution?: Record<string, any> | null,
  ): Promise<void> {
    const primaryId =
      await this.scenarioSharedService.resolveOpeningDialoguePrimaryLanguageId(
        metadataForPrimaryResolution,
      );

    const existing =
      await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
        scenarioId,
      );

    const toCreate: CreateScenarioTranslation[] = [];
    const toUpdate: UpdateScenarioTranslation[] = [];

    for (const [langIdStr, lines] of Object.entries(
      translationOpeningStatements,
    )) {
      const languageId = Number(langIdStr);
      if (!Number.isFinite(languageId)) continue;
      if (primaryId != null && languageId === primaryId) continue;

      const row = existing?.find((r) => Number(r.languageId) === languageId);
      const normalizedLines = Array.isArray(lines)
        ? lines.map((l) => String(l).trim()).filter((l) => l.length > 0)
        : [];

      const mergedMetadata = {
        ...(row?.metadata ?? {}),
        openingStatements: normalizedLines,
      };

      if (row) {
        toUpdate.push({ scenarioId, languageId, metadata: mergedMetadata });
      } else {
        toCreate.push({ scenarioId, languageId, metadata: mergedMetadata });
      }
    }

    if (toCreate.length) {
      await this.scenarioTranslationsRepository.createScenarioTranslations(
        toCreate,
      );
    }
    if (toUpdate.length) {
      await this.scenarioTranslationsRepository.updateScenarioTranslations(
        toUpdate,
      );
    }
  }

  /**
   * Target languages for auto-translation: scenario Language–Voice mappings only
   * (not the global catalog rule requiring male+female voices per language).
   */
  private async getTranslationTargetLanguagesFromLanguageVoices(
    languageVoices: Record<string, string> | null | undefined,
  ): Promise<
    Array<{
      language_id: number;
      value: string;
      label: string;
      translationCode: string;
    }>
  > {
    if (!languageVoices || typeof languageVoices !== 'object') {
      return [];
    }

    const languageIds = Object.entries(languageVoices)
      .filter(([, voiceId]) => voiceId != null && String(voiceId).trim() !== '')
      .map(([langId]) => Number(langId))
      .filter((id) => Number.isFinite(id));

    if (!languageIds.length) {
      return [];
    }

    const rows =
      await this.sharedLanguageService.getLanguagesByIds(languageIds);

    const isEnglishTranslationTarget = (code: string): boolean => {
      const c = code.trim().toLowerCase();
      return c === DEFAULT_LANGUAGE_TRANSLATION_CODE || c.startsWith('en-');
    };

    return (rows ?? [])
      .filter((l) => l.active)
      .filter((l) => l.translationCode && l.translationCode.trim() !== '')
      .filter((l) => !isEnglishTranslationTarget(l.translationCode))
      .map((l) => ({
        language_id: l.id,
        value: l.value,
        label: l.label,
        translationCode: l.translationCode.trim(),
      }));
  }

  /** Strip opening lines from auto-translate output so DB merges never overwrite manual/per-tab openings. */
  private omitOpeningStatementsFromTranslationMetadata(
    metadata: Partial<MetadataShape>,
  ): Partial<MetadataShape> {
    if (!metadata || typeof metadata !== 'object') {
      return metadata;
    }
    const rest = { ...metadata };
    delete rest.openingStatements;
    return rest;
  }

  /**
   * Persist translations for scenarios:
   * - creates new translations for new languageIds
   * - updates existing translations for existing languageIds
   */
  private async persistTranslationsForScenarios(
    scenarios: Array<Scenarios>,
    metadataExtractor: (scenario: Scenarios) => MetadataShape,
    translationConsiderableData?: TranslationConsiderableData,
    resolveLanguageVoices?: (
      scenario: Scenarios,
    ) => Record<string, string> | undefined,
    progressContext?: {
      userId: number;
      jobId: string;
      action: ScenarioTranslationAction;
    },
  ) {
    if (!scenarios.length) {
      return;
    }
    // If you expect many scenarios at once and want fewer DB calls, implement batching here.
    for (const scenario of scenarios) {
      const emitProgress = progressContext
        ? (
            status: ScenarioTranslationStatus,
            extra: Partial<{
              language: string;
              completed: number;
              total: number;
              error: string;
            }> = {},
          ) => {
            this.scenarioTranslationNotificationService.notifyProgress(
              progressContext.userId,
              {
                jobId: progressContext.jobId,
                scenarioId: scenario.id,
                scenarioTitle: scenario.title,
                action: progressContext.action,
                status,
                language: extra.language,
                completed: extra.completed ?? 0,
                total: extra.total ?? 0,
                error: extra.error,
                emittedAt: new Date().toISOString(),
              },
            );
          }
        : undefined;

      const onLanguageProgress: TranslationProgressCallback | undefined =
        emitProgress
          ? (event) => {
              if (event.kind === 'language_started') {
                emitProgress(ScenarioTranslationStatus.TRANSLATING, {
                  language: event.language,
                  completed: event.completed,
                  total: event.total,
                });
              } else if (event.kind === 'language_completed') {
                emitProgress(ScenarioTranslationStatus.TRANSLATED, {
                  language: event.language,
                  completed: event.completed,
                  total: event.total,
                });
              } else {
                emitProgress(ScenarioTranslationStatus.LANGUAGE_FAILED, {
                  language: event.language,
                  completed: event.completed,
                  total: event.total,
                  error: event.error,
                });
              }
            }
          : undefined;

      try {
        const rawMetadata = metadataExtractor(scenario);

        const sanitized = this.sanitizeMetadata(rawMetadata);

        if (
          !this.hasTranslatableFieldsChanged(
            scenario,
            sanitized as Partial<MetadataShape>,
          )
        ) {
          this.logger?.debug?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no translatable fields have changed, skipping translations`,
          );
          continue;
        }

        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        const languageVoices =
          resolveLanguageVoices?.(scenario) ??
          scenario.metadata?.languageVoices;
        const languagesFiltered =
          await this.getTranslationTargetLanguagesFromLanguageVoices(
            languageVoices,
          );
        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((l) => l.translationCode);

        emitProgress?.(ScenarioTranslationStatus.STARTED, {
          completed: 0,
          total: languageCodes.length,
        });

        this.logger.info(
          `[persistTranslationsForScenarios] invoking translation API for scenario ${scenario.id} → codes: ${languageCodes.join(', ')}`,
        );
        const translatedMap =
          await this.buildTranslatedMetadataForLanguageCodes(
            sanitized as Partial<MetadataShape>,
            languageCodes,
            translationConsiderableData as TranslationConsiderableData,
            onLanguageProgress,
          );

        // Build translatedList: map back to languageId
        const translatedList: Array<CreateScenarioTranslation> = [];
        for (const language of languagesFiltered) {
          const code = language.translationCode.trim();
          const translatedData = translatedMap[code];
          if (!translatedData || Object.keys(translatedData).length === 0)
            continue;
          translatedList.push({
            scenarioId: scenario.id,
            languageId: Number(language.language_id),
            metadata: translatedData as MetadataShape,
          });
        }

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }

        // Fetch existing translations for this scenario to split create vs update
        const existingTranslations =
          await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
            scenario.id,
          );

        const existingLanguageIdSet = new Set(
          (existingTranslations ?? []).map((r) => Number(r.languageId)),
        );

        const toCreate: Array<any> = [];
        const toUpdate: Array<any> = [];

        for (const t of translatedList) {
          const existingRow = existingTranslations?.find(
            (r) => Number(r.languageId) === Number(t.languageId),
          );
          const mergedMetadata = {
            ...(existingRow?.metadata ?? {}),
            ...this.omitOpeningStatementsFromTranslationMetadata(
              t.metadata as Partial<MetadataShape>,
            ),
          } as MetadataShape;
          const entry = {
            scenarioId: t.scenarioId,
            languageId: t.languageId,
            metadata: mergedMetadata,
          };
          if (existingLanguageIdSet.has(Number(t.languageId)))
            toUpdate.push(entry);
          else toCreate.push(entry);
        }

        // Persist creates first
        if (toCreate.length) {
          await this.scenarioTranslationsRepository.createScenarioTranslations(
            toCreate,
          );
        }

        if (toUpdate.length) {
          await this.scenarioTranslationsRepository.updateScenarioTranslations(
            toUpdate,
          );
        }

        const formattedResult: Record<string, ScenarioAppLangugeTranslations> =
          {};
        for (const [langCode, metadata] of Object.entries(translatedMap)) {
          formattedResult[langCode] = {
            title: metadata?.title,
            description: metadata?.description,
          };
        }

        const mergedTranslations = {
          ...(scenario.translations || {}),
          ...formattedResult,
        };

        this.dataSource
          .getRepository(Scenarios)
          .update(scenario.id, { translations: mergedTranslations });

        emitProgress?.(ScenarioTranslationStatus.COMPLETED, {
          completed: languageCodes.length,
          total: languageCodes.length,
        });
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistTranslationsForScenarios] unexpected error processing scenario ${scenario.id}`,
          { outerErr },
        );
        emitProgress?.(ScenarioTranslationStatus.FAILED, {
          error: (outerErr as Error)?.message ?? 'Unknown error',
        });
      }
    }
  }

  /**
   * Persist translations for scenario events:
   * - creates new translations for new languageIds
   * - updates existing translations for existing languageIds
   */
  async createUpdateScenarioEventsTranslations(scenarioEvents: any[]) {
    const validLanguagesCodes =
      await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();

    if (
      !Array.isArray(validLanguagesCodes) ||
      validLanguagesCodes.length == 0
    ) {
      this.logger?.warn?.(
        `[createUpdateScenarioEventsTranslations] no valid languages, skipping`,
      );
      return;
    }

    const { languages } =
      await this.sharedLanguageService.getValidLanguages(validLanguagesCodes);

    if (!languages || !languages.length) {
      this.logger?.warn?.(
        `[createUpdateScenarioEventsTranslations] no valid languages, skipping`,
      );
      return;
    }

    await this.persistScenarioEventTranslations(
      scenarioEvents, // array of session events or single-element array
      (sessionEvent) => ({
        message: sessionEvent.message,
        branchInstruction: sessionEvent.branchInstruction,
      }),
      languages,
    );
  }

  /**
   * Persist translations for scenario events:
   * - creates new translations for new languageIds
   * - updates existing translations for existing languageIds
   */
  async persistScenarioEventTranslations(
    scenarioEvents: Array<any>,
    metadataExtractor: (scenarioEvent: any) => {
      message: string;
      branchInstruction: string;
    },
    languages: any,
  ) {
    for (const scenarioEvent of scenarioEvents) {
      const rawMetadata = metadataExtractor(scenarioEvent);
      const sanitized = this.sanitizeMetadata({
        message: wrapFieldPlaceholders(rawMetadata?.message),
        branchInstruction: wrapFieldPlaceholders(
          rawMetadata?.branchInstruction,
        ),
      });

      if (!sanitized || Object.keys(sanitized).length === 0) {
        this.logger?.debug?.(
          `[persistSessionEventTranslations] ${scenarioEvent.id}: no non-empty metadata, skipping`,
        );
        continue;
      }

      const languagesFiltered = (languages ?? []).filter(
        (l: any) => l && l.translationCode && l.translationCode.trim() !== '',
      );

      if (!languagesFiltered.length) {
        this.logger?.warn?.(
          `[persistSessionEventTranslations] ${scenarioEvent.id}: no valid languages, skipping`,
        );
        continue;
      }

      const languageCodes = languagesFiltered.map((l: any) =>
        l.translationCode.trim(),
      );

      let translatedMap: Record<string, ScenarioEventsTranslationData> = {};
      try {
        const openaiResult =
          await this.openaiTranslationsService.translateObjectToLanguages(
            sanitized as Partial<ScenarioEventsTranslationData>,
            languageCodes,
            toPromptCode('openai_translation', 'session_event'),
          );

        if (openaiResult && Object.keys(openaiResult).length > 0) {
          this.logger?.debug?.(
            '[persistScenarioEventTranslations] successfully translated using OpenAI',
          );
          translatedMap = openaiResult as Record<
            string,
            ScenarioEventsTranslationData
          >;
        }
      } catch (err) {
        this.logger?.error?.(
          '[persistScenarioEventTranslations] translation call failed',
          { err, languageCodes },
        );
        translatedMap = {};
      }

      if (!translatedMap || Object.keys(translatedMap).length === 0) {
        this.logger?.warn?.(
          `[persistSessionEventTranslations] ${scenarioEvent.id}: no translations found, skipping`,
        );
        continue;
      }

      // Map translated map back to sessionEventId + languageId
      const translatedList: Array<CreateScenarioEventsTranslation> = [];

      for (const language of languagesFiltered) {
        const code = language.translationCode.trim();
        const translatedData = translatedMap[code];
        if (!translatedData || Object.keys(translatedData).length === 0)
          continue;
        translatedList.push({
          scenarioId: scenarioEvent.scenarioId,
          eventId: scenarioEvent.eventId,
          languageId: Number(language.id),
          message: unwrapFieldPlaceholders(translatedData.message) ?? '',
          branchInstruction:
            unwrapFieldPlaceholders(translatedData.branchInstruction) ?? '',
        });

        if (!translatedList.length) {
          this.logger?.debug?.(
            `[persistScenarioEventTranslations] ${scenarioEvent.id}: no translations after mapping, skipping DB ops`,
          );
          continue;
        }
      }

      // Fetch existing translations for this sessionEvent to split create vs update
      const existingTranslations =
        await this.scenarioEventTranslationsRepository.getScenarioEventsTranslationsByScenarioIdEventId(
          scenarioEvent.scenarioId,
          scenarioEvent.eventId,
        );

      const existingTranslationKeySet = new Set(
        (existingTranslations ?? []).map((r) => `${r.eventId}-${r.languageId}`),
      );

      const toCreate: Array<any> = [];
      const toUpdate: Array<any> = [];

      for (const t of translatedList) {
        const key = `${t.eventId}-${t.languageId}`;

        if (existingTranslationKeySet.has(key)) {
          toUpdate.push(t);
        } else {
          toCreate.push(t);
        }
      }

      if (toCreate.length) {
        await this.scenarioEventTranslationsRepository.createTranslations(
          toCreate,
        );
      }

      if (toUpdate.length) {
        await this.scenarioEventTranslationsRepository.updateTranslations(
          toUpdate,
        );
      }
    }
  }

  /**
   * Re-runs translation for every checklist item currently shown to
   * learners, across every scenario and every configured language.
   *
   * A checklist item's text comes from two places: the per-scenario
   * `ScenarioEvents` override (`message`/`branchInstruction`) and the base
   * `SessionEvents` row it references (`name`, plus its own `message`/
   * `branchInstruction` as a fallback when no override exists). Both need
   * retranslating to fully refresh a checklist item, so this re-translates
   * both sides for every `ScenarioEvents` row with
   * `checklistVisibilityStatus = true`.
   */
  async translateChecklistItems(): Promise<SuccessResponse> {
    const checklistEvents =
      await this.scenarioEventsRepository.getAllChecklistVisibleEvents();

    if (!checklistEvents.length) {
      return { success: true };
    }

    await this.createUpdateScenarioEventsTranslations(checklistEvents);

    const eventIds = Array.from(
      new Set(checklistEvents.map((event) => event.eventId)),
    );
    const sessionEvents =
      await this.sessionEventSharedService.findByIds(eventIds);

    if (sessionEvents.length) {
      await this.sessionEventTranslationService.createUpdateSessionEventTranslations(
        sessionEvents,
      );
    }

    return { success: true };
  }

  async getBranchingInstructionDynamicShortcuts(
    scenarioId?: number,
  ): Promise<string[]> {
    const dynamicBranchShortcuts: string[] = [
      ...BRANCHING_INSTRUCTION_DYNAMIC_SHORTCUTS,
    ];
    if (scenarioId) {
      const scenario = await this.getScenario(scenarioId);
      const customFields = scenario.metadata?.customFields;
      if (customFields) {
        dynamicBranchShortcuts.push(
          ...customFields.map((customField: any) => customField.name),
        );
      }
    }
    return dynamicBranchShortcuts;
  }

  async getAvailableModels(): Promise<
    {
      value: string;
      label: string;
      provider: string;
      supportsTemperature: boolean;
    }[]
  > {
    // Sourced from the universal LLM registry (single source of truth),
    // filtered to the providers the autofill/enhance/copilot path can actually
    // execute (OpenAI + Anthropic — no Gemini autofill client exists). This
    // replaces the old per-provider PREFERRED_* lists so a model added to the
    // registry surfaces here automatically.
    const AUTOFILL_PROVIDERS = new Set<LlmProviderName>([
      'openai',
      'anthropic',
    ]);
    return getLlmModels(LlmRuntime.ALLY_BE)
      .filter((m) => AUTOFILL_PROVIDERS.has(m.provider))
      .map((m) => ({
        value: m.model,
        label: m.label,
        provider: m.provider,
        supportsTemperature: m.supportsTemperature,
      }));
  }

  /**
   * Resolve which autofill service + model + temperature to use for a
   * prompt-driven studio-AI call (generate / enhance / agent-builder copilot).
   *
   * Precedence (later wins): code default → prompt-level config (from Prompt
   * Management) → the request's explicit override. This lets an author set a
   * per-prompt model/temperature that applies whenever the UI doesn't send an
   * explicit one (e.g. the Agent Builder Copilot, which sends none).
   *
   * Only OpenAI + Anthropic run autofill; a prompt-level Gemini provider is
   * ignored here (no Gemini autofill executor) so the call never breaks.
   * Temperature is dropped for models that reject a custom one (OpenAI
   * reasoning models).
   */
  private async resolveAutofillLlm(
    promptCode: string,
    req: { provider?: string; model?: string; temperature?: number },
  ): Promise<{
    service: OpenAIAutofillService | AnthropicAutofillService;
    provider: 'openai' | 'anthropic';
    model?: string;
    temperature?: number;
  }> {
    const registry = new Map<
      'openai' | 'anthropic',
      OpenAIAutofillService | AnthropicAutofillService
    >([
      ['openai', this.openAIAutofillService],
      ['anthropic', this.anthropicAutofillService],
    ]);
    const isRunnable = (p?: string): p is 'openai' | 'anthropic' =>
      p === 'openai' || p === 'anthropic';

    const promptCfg =
      await this.promptSharedService.getPromptLlmConfig(promptCode);

    if (req.provider && !isRunnable(req.provider)) {
      this.logger.warn(
        `Unrecognized autofill provider "${req.provider}", falling back to openai`,
      );
    }

    // Provider: request → prompt-level (if autofill-runnable) → openai.
    let provider: 'openai' | 'anthropic' = 'openai';
    if (isRunnable(req.provider)) provider = req.provider;
    else if (isRunnable(promptCfg.provider)) provider = promptCfg.provider;

    // Model: request → prompt-level (only when its provider matches the resolved
    // provider — a Claude model can't run on OpenAI) → service default.
    let model = req.model;
    if (!model && promptCfg.model && promptCfg.provider === provider) {
      model = promptCfg.model;
    }

    // Temperature: request → prompt-level; dropped for no-temperature models.
    let temperature =
      typeof req.temperature === 'number'
        ? req.temperature
        : promptCfg.temperature;
    const providerDefault =
      provider === 'anthropic'
        ? this.configService.anthropic?.autofillModel
        : this.configService.openai?.autofillModel;
    if (
      typeof temperature === 'number' &&
      !modelSupportsTemperature(model ?? providerDefault)
    ) {
      temperature = undefined;
    }

    return { service: registry.get(provider)!, provider, model, temperature };
  }

  /**
   * Field-level Enhance: improve the existing content of a single scenario
   * field. Unlike {@link generateField} this never invents content — it takes
   * the field's current value plus the other field values as grounding context
   * and rewrites it according to a preset/custom instruction. Provider routing
   * mirrors generateField.
   */
  async enhanceField(
    enhanceScenarioFieldDto: EnhanceScenarioFieldDto,
  ): Promise<EnhanceScenarioFieldResponseDto> {
    const { fieldName, currentValue, guidance, model, provider, translateTo } =
      enhanceScenarioFieldDto;

    if (!currentValue?.trim()) {
      throw new BadRequestException(
        'currentValue is required to enhance a field — there is nothing to improve.',
      );
    }

    // Blank custom box ⇒ generic auto-improve directive.
    const effectiveGuidance =
      guidance?.trim() || ENHANCE_AUTO_IMPROVE_INSTRUCTION;

    // The state field is structured: it carries a JSON {name, guidelines} and
    // expects a JSON object back. Everything else is plain text in/out and uses
    // the single generic enhance prompt (editable in Prompt Management).
    let promptCode: string;
    let variables: Record<string, string>;
    let expectJson = false;
    let stateInput: { name: string; guidelines: string } | null = null;
    if (fieldName === EnhanceableField.STATE) {
      let parsed: { name?: string; guidelines?: string } = {};
      try {
        parsed = JSON.parse(currentValue) as {
          name?: string;
          guidelines?: string;
        };
      } catch {
        throw new BadRequestException(
          'currentValue for a state must be JSON {"name","guidelines"}.',
        );
      }
      stateInput = {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        guidelines:
          typeof parsed.guidelines === 'string' ? parsed.guidelines : '',
      };
      if (!stateInput.name.trim() && !stateInput.guidelines.trim()) {
        throw new BadRequestException(
          'A state needs a name or guidelines before it can be improved.',
        );
      }
      promptCode = ENHANCE_STATE_PROMPT_CODE;
      variables = {
        currentName: stateInput.name,
        currentGuidelines: stateInput.guidelines,
        guidance: effectiveGuidance,
      };
      expectJson = true;
    } else {
      promptCode = ENHANCE_FIELD_PROMPT_CODE;
      variables = {
        fieldLabel: ENHANCEABLE_FIELD_LABELS[fieldName] ?? fieldName,
        currentValue,
        guidance: effectiveGuidance,
      };
    }

    const {
      service: autofillService,
      model: effectiveModel,
      temperature,
    } = await this.resolveAutofillLlm(promptCode, {
      provider,
      model,
      temperature: enhanceScenarioFieldDto.temperature,
    });

    const content = await autofillService.enhanceFieldContent(
      fieldName,
      promptCode,
      variables,
      expectJson,
      effectiveModel,
      temperature,
    );

    this.logger.info(`Enhancement completed for ${fieldName}`);

    // For the structured state field, normalise the model output into a clean,
    // guaranteed-parseable {name, guidelines} JSON string so the studio never
    // has to parse free-form prose. A missing key falls back to the original
    // value; unparseable output is a hard failure (surfaced as a 500 → error
    // toast) rather than silently corrupting the field.
    if (fieldName === EnhanceableField.STATE && stateInput) {
      return {
        fieldName,
        content: this.normaliseStateEnhanceOutput(content, stateInput),
      };
    }

    // Primary+translation fields (Challenge Description, Opening Dialogues):
    // re-translate the improved primary content into the scenario's other
    // languages so all languages stay in sync from one action. A failed
    // translation falls back to the original text (translateText behaviour)
    // rather than blocking the improve.
    if (translateTo?.length) {
      // Translate all target languages in parallel — sequential awaits add up
      // fast when a scenario has many languages.
      const entries = await Promise.all(
        translateTo.map(
          async (target) =>
            [
              target.languageId,
              await this.openaiTranslationsService.translateText(
                content,
                target.languageCode,
              ),
            ] as const,
        ),
      );
      return {
        fieldName,
        content,
        translations: Object.fromEntries(entries),
      };
    }

    return { fieldName, content };
  }

  /**
   * Coerce the model's state-enhance output into a clean, guaranteed-parseable
   * `{"name","guidelines"}` JSON string. Extracts the first balanced JSON
   * object (tolerating stray prose/braces around it), falls back to the
   * original value for any missing/blank key, and throws if nothing parseable
   * is found so the studio shows a failure toast instead of writing garbage.
   */
  private normaliseStateEnhanceOutput(
    raw: string,
    original: { name: string; guidelines: string },
  ): string {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    let parsed: { name?: unknown; guidelines?: unknown } | null = null;
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      throw new InternalServerErrorException(
        'State enhancement returned malformed JSON.',
      );
    }
    const pick = (value: unknown, fallback: string): string =>
      typeof value === 'string' && value.trim() ? value : fallback;
    return JSON.stringify({
      name: pick(parsed.name, original.name),
      guidelines: pick(parsed.guidelines, original.guidelines),
    });
  }

  /**
   * Agent Builder Copilot: generate ONE Basic Settings field from the
   * wizard's three inputs (actor brief + competency + agent test cases). Each
   * field has its own editable prompt template (src/prompts/agent_builder/)
   * and is fired independently in parallel by the frontend, so the results
   * paint into the form as each returns. Provider routing mirrors generateField.
   */
  async generateAgentBuilderField(
    dto: GenerateAgentBuilderFieldDto,
  ): Promise<GenerateAgentBuilderFieldResponseDto> {
    const { field, actorDescription, competency, agentTestCases, model } = dto;

    const numKnowledgeSources = dto.numKnowledgeSources ?? 3;
    const variables: Record<string, string> = {
      actorDescription: actorDescription ?? '',
      competency: competency ?? '',
      agentTestCases: agentTestCases ?? '',
      numKnowledgeSources: String(numKnowledgeSources),
    };

    // The prompt-file basename equals the enum value; toPromptCode maps it to
    // src/prompts/agent_builder/<field>.txt (editable in Prompt Management).
    const promptCode = toPromptCode('agent_builder', field);
    // Prose/HTML fields come back as plain text; structured fields as JSON.
    const expectJson =
      field === AgentBuilderField.TITLE ||
      field === AgentBuilderField.PERSONA ||
      field === AgentBuilderField.KNOWLEDGE_SOURCES ||
      field === AgentBuilderField.STATES ||
      field === AgentBuilderField.LINGUISTIC_STYLE_SAMPLES ||
      field === AgentBuilderField.ALLOWED_FILLER_WORDS;

    // Honor the prompt's per-prompt model/temperature (the wizard sends none),
    // with any explicit request override winning.
    const {
      service: autofillService,
      model: effectiveModel,
      temperature,
    } = await this.resolveAutofillLlm(promptCode, {
      provider: dto.provider,
      model,
      temperature: dto.temperature,
    });

    const raw = await autofillService.generateContentFromPrompt(
      promptCode,
      variables,
      expectJson,
      effectiveModel,
      temperature,
    );

    return { field, value: this.parseAgentBuilderField(field, raw) };
  }

  /**
   * Best-effort JSON parse of a model response. Tries a direct parse first (the
   * common case — expectJson responses are clean single objects/arrays), then
   * falls back to slicing the outermost `{ … }` when the model wraps the object
   * in prose. Returns the parsed value (object or array) or null.
   */
  private parseFirstJsonObject(raw: string): any {
    const attempt = (candidate: string): any => {
      try {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    };
    const direct = attempt(raw.trim());
    if (direct) return direct;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return attempt(raw.slice(start, end + 1));
  }

  /** Coerce a V2 field's raw model output into the shape the studio form expects. */
  private parseAgentBuilderField(
    field: AgentBuilderField,
    raw: string,
  ): unknown {
    switch (field) {
      case AgentBuilderField.ROLE_INSTRUCTION:
      case AgentBuilderField.CHALLENGE_DESCRIPTION:
      case AgentBuilderField.BACKSTORY:
      case AgentBuilderField.OPENING_STATEMENTS:
      case AgentBuilderField.REMINDERS:
        return raw.trim();

      case AgentBuilderField.TITLE: {
        const parsed = this.parseFirstJsonObject(raw);
        if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
          return parsed.title.trim();
        }
        // Fallback if the model ignored the JSON contract: take the first
        // non-empty line and strip wrapping quotes, so a stray prose response
        // still yields a usable title rather than a wall of text.
        const firstLine = raw
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0);
        return (firstLine ?? raw.trim()).replace(/^["']|["']$/g, '').trim();
      }

      case AgentBuilderField.PERSONA: {
        const p = this.parseFirstJsonObject(raw) ?? {};
        const allowedGenders = new Set(['male', 'female', 'non-binary']);
        const genderRaw =
          typeof p.gender === 'string' ? p.gender.trim().toLowerCase() : '';
        const ageNum =
          typeof p.age === 'number'
            ? p.age
            : typeof p.age === 'string' && p.age.trim() !== ''
              ? Number(p.age)
              : NaN;
        // Clamp to the documented 5–100 range the persona prompt asks for;
        // out-of-range / non-numeric values are dropped rather than written.
        const age = Number.isFinite(ageNum) ? Math.round(ageNum) : NaN;
        return {
          name: typeof p.name === 'string' ? p.name.trim() : undefined,
          age: age >= 5 && age <= 100 ? age : undefined,
          gender: allowedGenders.has(genderRaw) ? genderRaw : undefined,
          profession:
            typeof p.profession === 'string' ? p.profession.trim() : undefined,
          currentLocation:
            typeof p.currentLocation === 'string'
              ? p.currentLocation.trim()
              : undefined,
        };
      }

      case AgentBuilderField.KNOWLEDGE_SOURCES: {
        const parsed = this.parseFirstJsonObject(raw);
        // Prefer the documented `{ sources: [...] }`, but tolerate the model
        // returning a bare array or wrapping under a different key, so a minor
        // structural deviation doesn't silently drop all knowledge sources.
        let sources: any[] = [];
        if (Array.isArray(parsed)) {
          sources = parsed;
        } else if (Array.isArray(parsed?.sources)) {
          sources = parsed.sources;
        } else if (parsed && typeof parsed === 'object') {
          const arrayValue = Object.values(parsed).find((v) =>
            Array.isArray(v),
          );
          if (Array.isArray(arrayValue)) sources = arrayValue;
        }
        return sources
          .map((s: any) => ({
            title: typeof s?.title === 'string' ? s.title.trim() : '',
            content: typeof s?.content === 'string' ? s.content.trim() : '',
          }))
          .filter(
            (s: { title: string; content: string }) =>
              s.title.length > 0 && s.content.length > 0,
          );
      }

      case AgentBuilderField.STATES: {
        const parsed = this.parseFirstJsonObject(raw);
        // Prefer the documented `{ states: [...] }`, but tolerate a bare array
        // or the model wrapping the list under a different key — same leniency
        // as knowledge_sources. buildGeneratedStates then drops incomplete
        // entries and assigns ids + contiguous score bands.
        let items: any[] = [];
        if (Array.isArray(parsed)) {
          items = parsed;
        } else if (Array.isArray(parsed?.states)) {
          items = parsed.states;
        } else if (parsed && typeof parsed === 'object') {
          const arrayValue = Object.values(parsed).find((v) =>
            Array.isArray(v),
          );
          if (Array.isArray(arrayValue)) items = arrayValue;
        }
        return buildGeneratedStates(items);
      }

      case AgentBuilderField.LINGUISTIC_STYLE_SAMPLES: {
        return this.parseStringListField(raw, 'samples');
      }

      case AgentBuilderField.ALLOWED_FILLER_WORDS: {
        return this.parseStringListField(raw, 'fillers');
      }

      default:
        return raw.trim();
    }
  }

  /**
   * Shared lenient parser for fields whose contract is `{ <key>: string[] }` —
   * tolerates a bare array or the model wrapping the list under a different
   * key, same leniency as knowledge_sources/states. Drops non-string /
   * empty-after-trim entries.
   */
  private parseStringListField(raw: string, key: string): string[] {
    const parsed = this.parseFirstJsonObject(raw);
    let items: any[] = [];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (Array.isArray(parsed?.[key])) {
      items = parsed[key];
    } else if (parsed && typeof parsed === 'object') {
      const arrayValue = Object.values(parsed).find((v) => Array.isArray(v));
      if (Array.isArray(arrayValue)) items = arrayValue;
    }
    return items
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private getLanguageNameFromCode(code: string): string {
    const languageNames: Record<string, string> = {
      en: 'English',
      'en-IN': 'English (India)',
      'en-US': 'English (United States)',
      'en-GB': 'English (UK)',
      ml: 'Malayalam',
      'ml-IN': 'Malayalam',
      hi: 'Hindi',
      'hi-IN': 'Hindi',
      bn: 'Bengali',
      'bn-IN': 'Bengali',
      ta: 'Tamil',
      'ta-IN': 'Tamil',
      te: 'Telugu',
      'te-IN': 'Telugu',
      kn: 'Kannada',
      'kn-IN': 'Kannada',
      mr: 'Marathi',
      'mr-IN': 'Marathi',
      gu: 'Gujarati',
      'gu-IN': 'Gujarati',
      pa: 'Punjabi',
      'pa-IN': 'Punjabi',
      ur: 'Urdu',
      'ur-IN': 'Urdu',
      or: 'Odia',
      'or-IN': 'Odia',
      as: 'Assamese',
      'as-IN': 'Assamese',
    };
    return languageNames[code] ?? languageNames[code?.split('-')[0]] ?? code;
  }
}
