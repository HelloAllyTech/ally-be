import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager, In } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';

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
import { Pagination } from 'src/common/type/common.type';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { ScenarioStatus } from '../type/scenario.type';
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
  getPromptCodeForScenarioField,
} from '../util/scenario.util';
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
import { CreateScenarioTranslation } from '../interface/scenario-translation.interface';
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
  UPPER_MAX_TIMER_VALUE,
} from '../constants/scenario.constants';
import {
  wrapFieldPlaceholders,
  unwrapFieldPlaceholders,
} from 'src/session-event/util/session-event.util';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { ScenarioReportService } from 'src/scenario-report/service/scenario-report.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ScenarioBehaviorInstructionService } from './scenario-behavior-instruction.service';
import { ScenarioBehaviorInstructionRequest } from '../type/scenario-behavior-instructions.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { StateInstructionsDto } from '../dto/state-instructions.dto';
import { OpenAIAutofillService } from './openai-autofil-service';
import { GenerateScenarioFieldDto } from '../dto/generate-scenario-field.dto';
import { GenerateScenarioFieldResponseDto } from '../dto/generate-scenario-field-response.dto';
import {
  MAX_SCENARIO_STATE_INSTRUCTIONS,
  supportedStateInstructionStateIds,
} from '../constants/scenario-state-instructions.constants';
import { CompetencyService } from './competency.service';
import { BehaviorService } from './behavior.service';
import { GeneratableField } from '../enum/generatable-field.enum';
import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import {
  isValidTimeFormatHHMMSS,
  parseTimeToSeconds,
} from 'src/common/util/time.util';
import { COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS } from '../constants/competency-behavior-instruction-templates.constants';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

@Injectable()
export class ScenarioService {
  private readonly logger = LoggerService.getInstance(ScenarioService.name);
  static REQUIRED_CONTEXT_FIELDS: any;

  constructor(
    private scenariosRepository: ScenariosRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private sessionEventSharedService: SessionEventSharedService,
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
    private behaviorService: BehaviorService,
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

  async getScenariosV2(): Promise<GetScenarioDtoWithPagination> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const { data, count } = await this.scenariosRepository.getScenarios({
      tenantId,
    });

    return { data, count };
  }

  async getAdminScenarios(
    scenarioFilters?: ScenarioFilters,
    options?: Pagination,
  ) {
    const { status, tenantId, search } = scenarioFilters ?? {};
    if (tenantId) {
      const tenant = await this.tenantService.findById(tenantId);
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }
    const scenarios = await this.scenariosRepository.getAdminScenarios(
      { status, tenantId, search },
      options,
    );
    const mappedData = scenarios.map((item) => {
      const isPreviewEnabled =
        this.scenarioSharedService.hasAllActiveScenarioMandatoryFields(item);

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
        status: item.scenario_status,
        usage: item.usage,
        isAssignedToTenant: item.isAssignedToTenant,
        triggerWarnings: item.triggerWarnings,
        isPreviewEnabled,
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
  ): Promise<GetScenarioResponse> {
    const scenario = await this.scenariosRepository.getScenarioById(id, {
      select: options?.select,
      em: options?.em,
      isPublic: options?.isPublic,
    });

    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    return scenario;
  }

  async getAdminScenario(id: number): Promise<GetAdminScenarioDto> {
    return this.scenarioSharedService.getAdminScenario(id);
  }

  async getPresignedUrlForScenarioCoverImage(
    scenarioImageUploadRequestDto: ScenarioImageUploadRequestDto,
  ): Promise<ScenarioImageUploadResponseDto> {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }

    if (
      !Object.values(ScenarioImageUploadContentType).includes(
        scenarioImageUploadRequestDto.contentType,
      )
    ) {
      throw new BadRequestException('Invalid file type');
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
    const createScenarioDtos = await Promise.all(
      createScenariosDto.scenarios.map(async (scenario) => {
        await this.validateCreateScenario(scenario);
        return mapCreateScenarioRequestToEntity(scenario, userId);
      }),
    );

    try {
      return await this.dataSource.transaction(async (entityManager) => {
        const scenariosRepo = entityManager.getRepository(Scenarios);
        const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);
        const scenarios = scenariosRepo.create(createScenarioDtos);
        const savedScenarios = await scenariosRepo.save(scenarios);
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
          createScenariosDto.scenarios
            ?.map((scenario, index) => ({
              scenarioId: savedScenarios[index].id,
              behaviorInstructions: scenario.behaviorInstructions ?? [],
            }))
            ?.filter(
              (item): item is ScenarioBehaviorInstructionRequest =>
                item.behaviorInstructions.length > 0,
            ) ?? [];

        if (
          scenarioBehaviorInstructionList &&
          scenarioBehaviorInstructionList?.length > 0
        )
          await this.scenarioBehaviorInstructionService.createBehaviorInstructions(
            scenarioBehaviorInstructionList,
            entityManager,
          );

        // Persist translations for active scenarios
        const activeScenarios = savedScenarios.filter(
          (scenario) => scenario.status == ScenarioStatus.ACTIVE,
        );

        if (activeScenarios.length === 0) {
          for (const scenario of activeScenarios) {
            const translationConsiderableData: TranslationConsiderableData = {
              currentLocation: scenario.metadata?.currentLocation,
              lifeHistory: scenario.metadata?.lifeHistory,
              personality: scenario.metadata?.personality,
              coreMemories: scenario.metadata?.coreMemories,
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
                  tone: scenario.metadata?.tone,
                  personality: scenario.metadata?.personality,
                  context: scenario.metadata?.context,
                  openingStatements: scenario.metadata?.openingStatements,
                  sexualOrientation: scenario.metadata?.sexualOrientation,
                  genderIdentity: scenario.metadata?.genderIdentity,
                  customFields: scenario.metadata?.customFields,
                  stateInstructions: scenario.metadata?.stateInstructions,
                }),
              translationConsiderableData,
            );
          }
        }

        return savedScenarios;
      });
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

    if (createScenarioDto.status === ScenarioStatus.ACTIVE) {
      await this.validateLinguisticStyleSamplesForNonEnglish(
        createScenarioDto.languageVoices,
        createScenarioDto.linguisticStyleSamples,
      );
    }

    if (createScenarioDto.voiceId)
      await this.getScenarioVoice(createScenarioDto?.voiceId);
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
      await this.scenarioBehaviorInstructionService.validateBehaviorInstructions(
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
      const ACTIVE_SCENARIO_MANDATORY_FIELDS = getActiveScenarioMandatoryFields(
        this.configService.featureFlag.stateBasedScenarioInstructions,
      );
      const missingFields = ACTIVE_SCENARIO_MANDATORY_FIELDS.filter(
        (field) => !data[field as keyof typeof data],
      );

      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing for ACTIVE scenario: ${missingFields.join(', ')}`,
        );
      }

      this.validateStateInstructions(data?.stateInstructions);
    }
  }

  private validateStateInstructions(
    stateInstructions: StateInstructionsDto[] = [],
  ) {
    if (!stateInstructions) {
      throw new BadRequestException('State instructions are required');
    }
    const validStateInstructions = stateInstructions.filter(
      (instruction) =>
        instruction.stateId &&
        instruction.instruction &&
        instruction.dialogues &&
        instruction.dialogues.length > 0 &&
        instruction.dialogues.every((dialogue) => dialogue.trim()?.length > 0),
    );
    if (validStateInstructions.length !== stateInstructions.length) {
      throw new BadRequestException('State instructions are required');
    }
    if (validStateInstructions.length !== MAX_SCENARIO_STATE_INSTRUCTIONS) {
      throw new BadRequestException(
        `State instructions must be ${MAX_SCENARIO_STATE_INSTRUCTIONS}`,
      );
    }
    if (
      validStateInstructions.some(
        (instruction) =>
          !supportedStateInstructionStateIds.includes(instruction.stateId),
      )
    ) {
      throw new BadRequestException('Invalid state instruction state ID');
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
   * For ACTIVE scenarios with non-English languages in languageVoices,
   * linguisticStyleSamples must contain at least one non-empty sample per language.
   */
  private async validateLinguisticStyleSamplesForNonEnglish(
    languageVoices?: Record<string, string>,
    linguisticStyleSamples?: Record<string, string[]>,
  ): Promise<void> {
    if (!languageVoices || Object.keys(languageVoices).length === 0) {
      return;
    }

    const languageIds = Object.keys(languageVoices)
      .map((id) => parseInt(id, 10))
      .filter((id) => !Number.isNaN(id));

    if (languageIds.length === 0) {
      return;
    }

    const languages =
      await this.sharedLanguageService.getLanguagesByIds(languageIds);
    const nonEnglishIds = languages
      .filter((lang) => {
        const code = (lang.translationCode || lang.value || '').toLowerCase();
        return code && !code.startsWith('en');
      })
      .map((lang) => String(lang.id));

    if (nonEnglishIds.length === 0) {
      return;
    }

    const samples = linguisticStyleSamples ?? {};
    const missing: string[] = [];
    for (const langId of nonEnglishIds) {
      const langSamples = samples[langId];
      const hasContent =
        Array.isArray(langSamples) &&
        langSamples.some((s) => typeof s === 'string' && s.trim().length > 0);
      if (!hasContent) {
        const lang = languages.find((l) => String(l.id) === langId);
        missing.push(lang?.label ?? langId);
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Linguistic style samples are required for non-English languages. ` +
          `Please provide at least one sample for: ${missing.join(', ')}`,
      );
    }
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
  ): Promise<boolean> {
    const scenario = await this.validateUpdateScenario(id, updateScenarioDto);
    await this.checkForInProgressScenarioReports(scenario.id);

    try {
      return await this.dataSource.transaction(async (entityManager) => {
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
            lifeHistory: scenario.metadata?.lifeHistory,
            personality: scenario.metadata?.personality,
            coreMemories: scenario.metadata?.coreMemories,
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
                tone: updateScenarioDto.tone,
                personality: updateScenarioDto.personality,
                context: updateScenarioDto.context,
                openingStatements: updateScenarioDto.openingStatements,
                sexualOrientation: updateScenarioDto.sexualOrientation,
                genderIdentity: updateScenarioDto.genderIdentity,
                customFields: updateScenarioDto?.customFields,
                stateInstructions: updateScenarioDto?.stateInstructions,
              }),
            translationConsiderableData,
          );
        }
        await this.updateScenarioTerminationEvents(
          id,
          updateScenarioDto?.terminationEvents || [],
          entityManager,
        );

        // Update behavior instructions
        if (
          updateScenarioDto.behaviorInstructions &&
          updateScenarioDto.behaviorInstructions?.length > 0
        ) {
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

        return true;
      });
    } catch (error) {
      this.logger.error(
        `Failed to update scenario with error ${JSON.stringify(error)}`,
      );
      throw new BadRequestException(
        `Failed to update scenario: ${error.message}`,
      );
    }
  }

  async duplicateScenario(id: number): Promise<Scenarios> {
    const scenario = await this.scenariosRepository.findOne({ where: { id } });
    if (!scenario) {
      throw new NotFoundException('Scenario not found ');
    }

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
            instructions: instruction.instructions,
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

      if (updateScenarioDto.status === ScenarioStatus.ACTIVE) {
        const languageVoices =
          updateScenarioDto.languageVoices ?? scenario.metadata?.languageVoices;
        const linguisticStyleSamples =
          updateScenarioDto.linguisticStyleSamples ??
          scenario.metadata?.linguisticStyleSamples;
        await this.validateLinguisticStyleSamplesForNonEnglish(
          languageVoices,
          linguisticStyleSamples,
        );
      }
    }

    if (updateScenarioDto.voiceId) {
      await this.getScenarioVoice(updateScenarioDto?.voiceId);
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
      await this.scenarioBehaviorInstructionService.validateBehaviorInstructions(
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

  async deleteAdminScenario(id: number): Promise<boolean> {
    // To check if the scenario exists
    await this.getAdminScenario(id);

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

  async mapEventsToScenario(createScenarioEventsDto: CreateScenarioEventsDto) {
    const { scenarioId, events } = createScenarioEventsDto;

    await this.validateMapEventsToScenario(scenarioId, events);
    await this.checkForInProgressScenarioReports(scenarioId);

    try {
      return await this.dataSource.transaction(async (entityManager) => {
        const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);

        // Create an array of ScenarioEvents entities to be saved
        const scenarioEvents = await Promise.all(
          events.map(async (event) => {
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
          }),
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
      });
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
    }
  }

  async deleteScenarioEvents(scenarioEvents: DeleteScenarioEventsDto) {
    const { scenarioId, eventIds } = scenarioEvents;
    if (eventIds.length === 0) {
      throw new BadRequestException('Event IDs array cannot be empty');
    }

    await this.getScenario(scenarioId);
    await this.checkForInProgressScenarioReports(scenarioId);

    const result = await this.scenarioEventsRepository.delete({
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
   * Sanitize metadata: remove null/undefined values and trim strings
   */
  private sanitizeMetadata<T extends Record<string, any>>(
    metadata: T,
  ): Partial<T> {
    const cleaned: Partial<T> = {};

    for (const key in metadata) {
      if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
      const value = metadata[key as keyof T];
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') {
          continue;
        }

        cleaned[key as keyof T] = trimmed as any;
      } else {
        cleaned[key as keyof T] = value;
      }
    }

    return cleaned;
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

  /**
   * Persist translations for scenarios:
   * - creates new translations for new languageIds
   * - updates existing translations for existing languageIds
   */
  private async persistTranslationsForScenarios(
    scenarios: Array<Scenarios>,
    metadataExtractor: (scenario: Scenarios) => MetadataShape,
    translationConsiderableData?: TranslationConsiderableData,
  ) {
    if (!scenarios.length) {
      return;
    }
    // If you expect many scenarios at once and want fewer DB calls, implement batching here.
    for (const scenario of scenarios) {
      try {
        const rawMetadata = metadataExtractor(scenario);

        const sanitized = this.sanitizeMetadata(rawMetadata);

        if (!sanitized || Object.keys(sanitized).length === 0) {
          this.logger?.debug?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no non-empty metadata, skipping`,
          );
          continue;
        }

        // Picking all languages with voices
        const languages = await this.getLanguagesForScenario(true, true);

        const languagesFiltered = (languages ?? []).filter(
          (l: any) =>
            l &&
            l.translationCode &&
            l.translationCode.trim() !== '' &&
            !l.value.includes(DEFAULT_LANGUAGE_TRANSLATION_CODE),
        );
        if (!languagesFiltered.length) {
          this.logger?.warn?.(
            `[persistTranslationsForScenarios] scenario ${scenario.id}: no valid languages, skipping`,
          );
          continue;
        }

        const languageCodes = languagesFiltered.map((l: any) =>
          l.translationCode.trim(),
        );

        const translatedMap =
          await this.buildTranslatedMetadataForLanguageCodes(
            sanitized as Partial<MetadataShape>,
            languageCodes,
            translationConsiderableData as TranslationConsiderableData,
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
          if (existingLanguageIdSet.has(Number(t.languageId))) toUpdate.push(t);
          else toCreate.push(t);
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
      } catch (outerErr) {
        this.logger?.error?.(
          `[persistTranslationsForScenarios] unexpected error processing scenario ${scenario.id}`,
          { outerErr },
        );
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
        message: rawMetadata?.message,
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
            PromptCode.OPENAI_SESSION_EVENT_TRANSLATION_PROMPT_CODE,
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
          message: translatedData.message ?? '',
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

  async getAvailableModels(): Promise<{ value: string; label: string }[]> {
    return this.openAIAutofillService.getAvailableModels();
  }

  async generateField(
    generateScenarioFieldDto: GenerateScenarioFieldDto,
  ): Promise<GenerateScenarioFieldResponseDto> {
    const { fieldName, scenarioContext, model } = generateScenarioFieldDto;

    let promptCode = getPromptCodeForScenarioField(fieldName);

    // Use English-specific prompt for linguistic style when language is English
    if (
      fieldName === GeneratableField.LINGUISTIC_STYLE_SAMPLES &&
      scenarioContext.languageCode?.toLowerCase().startsWith('en')
    ) {
      promptCode =
        PromptCode.OPENAI_SIMULATION_LINGUISTIC_STYLE_SAMPLES_ENGLISH_PROMPT_CODE;
    }

    if (!promptCode) {
      throw new BadRequestException(
        `Field "${fieldName}" is not supported for auto-generation`,
      );
    }

    let behaviorIdMapping;
    if (fieldName === GeneratableField.BEHAVIOR_INSTRUCTIONS) {
      if (!scenarioContext.competency) {
        throw new BadRequestException(
          'Competency is required for behavior instruction generation',
        );
      }

      const { data: behaviors } = await this.behaviorService.getBehaviors();
      const result =
        this.openAIAutofillService.buildBehaviorIdMapping(behaviors);
      behaviorIdMapping = result.mapping;

      this.logger.info(
        `Loaded ${behaviors.length} behaviors, mapped ${result.mapping.size} IDs`,
      );

      let hasPredefined = false;

      const predefinedBehaviors =
        COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS[scenarioContext.competency];

      if (predefinedBehaviors?.length) {
        const nameToSeqId = new Map<string, number>();
        for (const [seqId, behavior] of result.mapping.entries()) {
          nameToSeqId.set(behavior.name, seqId);
        }

        const shouldDo: number[] = [];
        const shouldNotDo: number[] = [];

        for (const template of predefinedBehaviors) {
          const seqId = nameToSeqId.get(template.behaviorName);
          if (seqId === undefined) continue;
          if (template.category === BehaviorInstructionCategory.SHOULD_DO) {
            shouldDo.push(seqId);
          } else {
            shouldNotDo.push(seqId);
          }
        }

        if (shouldDo.length > 0 || shouldNotDo.length > 0) {
          hasPredefined = true;
          const predefinedDoc: Record<string, number[]> = {};
          if (shouldDo.length > 0) predefinedDoc.SHOULD_DO = shouldDo;
          if (shouldNotDo.length > 0) predefinedDoc.SHOULD_NOT_DO = shouldNotDo;
          scenarioContext.predefinedBehaviorInstructionsDoc =
            JSON.stringify(predefinedDoc);

          const usedSeqIds = new Set([...shouldDo, ...shouldNotDo]);
          const relevantLines = [...usedSeqIds]
            .map((seqId) => {
              const b = result.mapping.get(seqId);
              return b ? `${seqId}. ${b.name}` : null;
            })
            .filter(Boolean);
          scenarioContext.allowedHelperBehaviorsList = relevantLines.join('\n');

          this.logger.info(
            `Using predefined presets: ${shouldDo.length} SHOULD_DO, ${shouldNotDo.length} SHOULD_NOT_DO behaviors`,
          );
        }
      }

      if (!hasPredefined) {
        scenarioContext.allowedHelperBehaviorsList = result.formattedList;
        this.logger.info(
          `No presets found for "${scenarioContext.competency}", using full behavior list`,
        );
      }
    }

    let contextToUse = scenarioContext;
    if (fieldName === GeneratableField.LINGUISTIC_STYLE_SAMPLES) {
      if (!scenarioContext.languageId || !scenarioContext.languageCode) {
        throw new BadRequestException(
          'languageId and languageCode are required for linguistic style samples generation',
        );
      }
      const languageName =
        scenarioContext.languageName ||
        this.getLanguageNameFromCode(scenarioContext.languageCode);
      // Build prompt vars from visible UI fields only: characterProfileText, challengeDescription
      const characterSummary = scenarioContext.characterProfileText ?? '';
      const challengeSummary = scenarioContext.challengeDescription ?? '';
      const emotionalState = [characterSummary, challengeSummary]
        .filter(Boolean)
        .join('. ');
      contextToUse = {
        ...scenarioContext,
        language_name: languageName,
        language_code: scenarioContext.languageCode,
        location: scenarioContext.currentLocation ?? '',
        name: scenarioContext.name ?? 'Client',
        age: scenarioContext.age ?? '',
        gender: scenarioContext.gender ?? '',
        emotional_state: emotionalState,
      } as any;
    }

    const content = await this.openAIAutofillService.generateFieldContent(
      fieldName,
      promptCode,
      contextToUse,
      behaviorIdMapping,
      model,
    );

    this.logger.info(`Generation completed for ${fieldName}`);

    return { fieldName, content };
  }

  private getLanguageNameFromCode(code: string): string {
    const languageNames: Record<string, string> = {
      en: 'English',
      'en-IN': 'English (India)',
      'en-US': 'English (United States)',
      'en-GB': 'English (Global)',
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
