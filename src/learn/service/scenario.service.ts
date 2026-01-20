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
import { SessionEventService } from 'src/session-event/service/session-event.service';
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
  formatSingleAutoTerminationEventsList,
  formatScenarioTriggerWarningsList,
  getActiveScenarioMandatoryFields,
  mapCreateScenarioRequestToEntity,
  mapUpdateScenarioRequestToEntity,
  formatAutoTerminationEventsList,
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
import { MetadataShape } from '../type/scenario-translation-metadata.type';
import { CreateScenarioTranslation } from '../interface/scenario-translation.interface';
import {
  CreateScenarioEventsTranslation,
  ScenarioEventsTranslationData,
} from '../interface/scenario-events-translation.interface';
import { DEFAULT_LANGUAGE_TRANSLATION_CODE } from '../constants/scenario-session.constants';
import { TerminationEventsDto } from '../dto/termination-events.dto';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { BRANCHING_INSTRUCTION_DYNAMIC_SHORTCUTS } from '../constants/scenario.constants';

@Injectable()
export class ScenarioService {
  private readonly logger = LoggerService.getInstance(ScenarioService.name);

  constructor(
    private scenariosRepository: ScenariosRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private sessionEventService: SessionEventService,
    private tenantService: TenantService,
    private scenarioVoiceRepository: ScenarioVoicesRepository,
    private s3Service: S3Service,
    private configService: AppConfigService,
    private dataSource: DataSource,
    private scenarioPathSharedService: ScenarioPathSharedService,
    private triggerWarningsService: TriggerWarningsService,
    private scenarioTranslationsRepository: ScenarioTranslationsRepository,
    private googleTranslationsService: GoogleTranslationsService,
    private sharedLanguageService: SharedLanguageService,
    private scenarioSharedService: ScenarioSharedService,
    private scenarioEventTranslationsRepository: ScenarioEventsTranslationsRepository,
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
      const isPreviewEnabled = this.checkPreviewEnabled(item);

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

  private checkPreviewEnabled(item: any): boolean {
    const metadata = item.scenario_metadata || {};

    const ACTIVE_SCENARIO_MANDATORY_FIELDS = getActiveScenarioMandatoryFields();
    const missingFields = ACTIVE_SCENARIO_MANDATORY_FIELDS.filter((field) => {
      let value = undefined;

      if (metadata.hasOwnProperty(field)) {
        value = metadata[field];
      } else {
        const prefixedFieldName = `scenario_${field}`;
        if (item.hasOwnProperty(prefixedFieldName)) {
          value = item[prefixedFieldName];
        }
      }

      if (value === null || value === undefined) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      if (Array.isArray(value) && value.length === 0) return true;

      return false;
    });

    return missingFields.length === 0;
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
    const result = await this.scenariosRepository.getAdminScenarioById(id);

    if (!result) {
      throw new NotFoundException('Scenario not found');
    }

    // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove this check and vale inside
    if (result?.terminationEvent?.eventId) {
      const eventDetails = await this.sessionEventService.findSessionEventById(
        result.terminationEvent.eventId,
      );
      result.terminationEvent.name = eventDetails?.name;
    }

    if (result?.terminationEvents && result?.terminationEvents?.length > 0) {
      const terminationEvents = await Promise.all(
        result.terminationEvents.map(async (event) => {
          if (event.eventId) {
            const eventDetails =
              await this.sessionEventService.findSessionEventById(
                event.eventId,
              );
            return { ...event, name: eventDetails?.name };
          }
          return event;
        }),
      );
      result.terminationEvents = terminationEvents;
    }

    return result;
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

    const { fileName, fileSize, contentType } = scenarioImageUploadRequestDto;

    if (!Object.values(ScenarioImageUploadContentType).includes(contentType)) {
      throw new BadRequestException('Invalid file type');
    }

    const maxFileSize = 2 * 1024 * 1024; // 2 MB
    if (fileSize > maxFileSize) {
      throw new BadRequestException(
        `File size must be less than ${maxFileSize / 1024 / 1024} MB`,
      );
    }

    const sanitizedFileName = this.s3Service.sanitizeFileName(fileName);

    const storageKey = `scenario-cover-images/${Date.now()}-${sanitizedFileName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600, // 10 minutes
      contentType,
    });

    const region = this.configService.aws.region;
    const coverImageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;

    return { presignedUrl, coverImageUrl };
  }

  async deleteCoverImage(deleteCoverImageDto: DeleteCoverImageDto) {
    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }
    const coverImageUrl = deleteCoverImageDto.coverImageUrl;
    const s3CoverImageUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const coverImageUrlMatch = coverImageUrl.match(s3CoverImageUrlPattern);
    const storageKey = coverImageUrlMatch ? coverImageUrlMatch[1] : null;
    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 URL: ${coverImageUrl}`);
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
        `Failed to delete uploaded cover image with error ${JSON.stringify(
          error,
        )}`,
      );
      return { success: false };
    }
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
        const autoTerminationEventList = this.configService?.featureFlag
          ?.multipleTerminationEvents
          ? formatAutoTerminationEventsList(createScenariosDto, savedScenarios)
          : formatSingleAutoTerminationEventsList(
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

        await this.persistTranslationsForScenarios(
          savedScenarios.filter(
            (scenario) => scenario.status == ScenarioStatus.ACTIVE,
          ),
          (scenario) =>
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
            }),
        );

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
    const validEvents = await this.sessionEventService.findByIds(
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
      // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove this check
      if (
        data.autoTerminationStatus &&
        (!data.terminationEventId || !data.terminationMessage)
      ) {
        throw new BadRequestException(
          'Termination event and message are required for enabling auto termination',
        );
      }

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

  async updateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
    userId: number,
  ): Promise<boolean> {
    const scenario = await this.validateUpdateScenario(id, updateScenarioDto);

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
          await this.persistTranslationsForScenarios(
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
              }),
          );
        }

        const isMultipleTerminationEventSupported =
          this.configService?.featureFlag?.multipleTerminationEvents;
        if (isMultipleTerminationEventSupported) {
          await this.updateScenarioTerminationEvents(
            id,
            updateScenarioDto?.terminationEvents || [],
            entityManager,
          );
        } else {
          // Single termination event support
          const scenarioEventsRepo =
            entityManager.getRepository(ScenarioEvents);
          const existingScenarioTerminationEvent =
            await scenarioEventsRepo.findOne({
              where: { scenarioId: id, autoTerminationStatus: true },
            });
          // The already existing termination event is not the one in update query or the autoterminationstatus is set to false- delete the event
          if (
            existingScenarioTerminationEvent &&
            (!updateScenarioDto.autoTerminationStatus ||
              existingScenarioTerminationEvent.eventId !==
                updateScenarioDto.terminationEventId)
          ) {
            await scenarioEventsRepo.delete({
              scenarioId: id,
              eventId: existingScenarioTerminationEvent.eventId,
              autoTerminationStatus: true,
            });

            this.scenarioEventTranslationsRepository.delete({
              scenarioId: id,
              eventId: existingScenarioTerminationEvent.eventId,
            });
          }
          // If the input termination event id is the same as the existing one - update the message
          if (
            existingScenarioTerminationEvent?.eventId ===
              updateScenarioDto.terminationEventId &&
            updateScenarioDto.autoTerminationStatus
          ) {
            await scenarioEventsRepo.update(
              {
                scenarioId: id,
                eventId: updateScenarioDto.terminationEventId,
                autoTerminationStatus: true,
              },
              { message: updateScenarioDto.terminationMessage },
            );
            // Create/update the translation for the new termination event
            this.createUpdateScenarioEventsTranslations([
              {
                scenarioId: id,
                eventId: updateScenarioDto.terminationEventId,
                message: updateScenarioDto.terminationMessage,
              },
            ]);
          } else if (updateScenarioDto.autoTerminationStatus) {
            const newTerminationEvent = scenarioEventsRepo.create({
              scenarioId: id,
              eventId: updateScenarioDto.terminationEventId,
              autoTerminationStatus: true,
              message: updateScenarioDto.terminationMessage,
            });
            scenarioEventsRepo.save(newTerminationEvent);
            // Create/update the translation for the new termination event
            this.createUpdateScenarioEventsTranslations([newTerminationEvent]);
          }
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
    const validEvents = await this.sessionEventService.findByIds(eventIds);
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
    options: Pagination,
  ): Promise<ScenarioVoices[]> {
    return this.scenarioVoiceRepository.getScenarioVoices(searchName, options);
  }

  async getScenarioVoice(id: string): Promise<ScenarioVoices> {
    const scenarioVoice = await this.scenarioVoiceRepository.findOne({
      where: { id },
    });

    if (!scenarioVoice) {
      throw new NotFoundException('Scenario voice not found');
    }

    return scenarioVoice;
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
   */
  private async buildTranslatedMetadataForLanguageCodes(
    metadataObj:
      | Partial<MetadataShape>
      | Partial<{ message: string; branchInstruction: string }>,
    languageCodes: string[],
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
      const translated =
        await this.googleTranslationsService.translateObjectToLanguages(
          metadataObj,
          codes,
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
        branchInstruction: rawMetadata?.branchInstruction,
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

      const translatedMap = (await this.buildTranslatedMetadataForLanguageCodes(
        sanitized as Partial<ScenarioEventsTranslationData>,
        languageCodes,
      )) as Record<string, ScenarioEventsTranslationData>;

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
          branchInstruction: translatedData.branchInstruction ?? '',
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
}
