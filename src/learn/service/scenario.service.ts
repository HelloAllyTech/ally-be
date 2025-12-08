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
import { CreateScenarioEventsDto } from '../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../dto/delete-scenario-events.dto';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { ScenarioStatus } from '../enum/scenario.status.enum';
import { SCENARIO_STATUS_MAP } from 'src/learn/constants/scenario-status.map';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioImageUploadRequestDto } from '../dto/scenario-image-upload-request.dto';
import { ScenarioImageUploadResponseDto } from '../dto/scenario-image-upload-response.dto';
import { ScenarioImageUploadContentType } from '../enum/scenario-image-upload-content-type.enum';
import { ScenarioEventsRepository } from '../repository/scenario-events.repository';
import { SCENARIO_MANDATORY_FIELDS } from '../constants/scenario-mandatory-fields.constants';
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
  formatAutoTerminationEventsList,
  formatScenarioTriggerWarningsList,
  mapCreateScenarioRequestToEntity,
} from '../util/scenario.util';
import { TenantService } from 'src/tenant/service/tenant.service';
import { ScenarioTenants } from '../entity/scenario-tenants.entity';
import { ScenarioTriggerWarnings } from '../entity/scenario-trigger-warnings.entity';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import { ScenarioFilters } from '../type/scenario-filter.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';

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
  ) {}

  async getScenarios(): Promise<GetScenarioDto[]> {
    const { data } = await this.scenariosRepository.getScenarios();
    return data;
  }

  async getPublicScenarios(): Promise<GetScenarioDtoWithPagination> {
    const { data, count } = await this.scenariosRepository.getScenarios();

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
        isPreviewEnabled,
      };
    });

    return { data: mappedData };
  }

  private checkPreviewEnabled(item: any): boolean {
    const metadata = item.scenario_metadata || {};

    const missingFields = SCENARIO_MANDATORY_FIELDS.filter((field) => {
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
    }));

    return { data, count: result.count };
  }

  async getScenario(
    id: number,
    select?: (keyof Scenarios)[],
    em?: EntityManager,
  ) {
    const scenarioRepo =
      em?.getRepository(Scenarios) || this.scenariosRepository;
    const scenario = await scenarioRepo.findOne({
      select,
      where: {
        id,
        status: In([ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE]),
      },
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

    if (result?.terminationEvent?.eventId) {
      const eventDetails = await this.sessionEventService.findSessionEventById(
        result.terminationEvent.eventId,
      );
      result.terminationEvent.name = eventDetails?.name;
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

      return savedScenarios;
    });
  }

  async validateCreateScenario(
    createScenarioDto: CreateScenarioDto,
  ): Promise<void> {
    this.validateScenarioStatus(createScenarioDto);

    if (createScenarioDto.voiceId)
      await this.getScenarioVoice(createScenarioDto?.voiceId);
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
      if (
        data.autoTerminationStatus &&
        (!data.terminationEventId || !data.terminationMessage)
      ) {
        throw new BadRequestException(
          'Termination event and message are required for enabling auto termination',
        );
      }

      const missingFields = SCENARIO_MANDATORY_FIELDS.filter(
        (field) => !data[field as keyof typeof data],
      );

      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing for ACTIVE scenario: ${missingFields.join(', ')}`,
        );
      }
    }
  }

  async updateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
    userId: number,
  ): Promise<boolean> {
    const scenario = await this.validateUpdateScenario(id, updateScenarioDto);
    return await this.dataSource.transaction(async (entityManager) => {
      // Build update object
      const updateData: DeepPartial<Scenarios> = {
        updatedBy: userId,
      };

      const updateScenarioObjectFields = [
        'title',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
        'prompt',
        'isGlobal',
      ];

      for (const field of updateScenarioObjectFields) {
        if (updateScenarioDto[field as keyof UpdateScenarioDto] !== undefined) {
          updateData[field as keyof Scenarios] = updateScenarioDto[
            field as keyof UpdateScenarioDto
          ] as any;
        }
      }

      // Handle metadata fields - merge with existing metadata
      const metadataUpdates: Record<string, any> = {};

      const metadataFieldMap = {
        agentGoal: updateScenarioDto.agentGoal,
        name: updateScenarioDto.name,
        age: updateScenarioDto.age,
        gender: updateScenarioDto.gender,
        genderIdentity: updateScenarioDto.genderIdentity,
        sexualOrientation: updateScenarioDto.sexualOrientation,
        currentLocation: updateScenarioDto.currentLocation,
        profession: updateScenarioDto.profession,
        context: updateScenarioDto.context,
        sessionBehaviorGuidelines: updateScenarioDto.sessionBehaviorGuidelines,
        lifeHistory: updateScenarioDto.lifeHistory,
        coreMemories: updateScenarioDto.coreMemories,
        personality: updateScenarioDto.personality,
        startingState: updateScenarioDto.startingState,
        emotionalNeeds: updateScenarioDto.emotionalNeeds,
        tone: updateScenarioDto.tone,
        openingStatements: updateScenarioDto.openingStatements,
        voiceId: updateScenarioDto.voiceId,
      };

      // Only include fields that are defined
      for (const [key, value] of Object.entries(metadataFieldMap)) {
        if (value !== undefined) {
          metadataUpdates[key] = value;
        }
      }

      // If there are metadata updates, merge with existing metadata
      if (Object.keys(metadataUpdates).length > 0) {
        updateData.metadata = {
          ...scenario.metadata,
          ...metadataUpdates,
        };
      }

      const scenarioRepository = entityManager.getRepository(Scenarios);
      const updated = await scenarioRepository.update(id, updateData);
      const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);
      const existingScenarioTerminationEvent = await scenarioEventsRepo.findOne(
        {
          where: { scenarioId: id, autoTerminationStatus: true },
        },
      );
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
      }
      // If the input termination event id is the same as the existing one - update the message
      if (
        existingScenarioTerminationEvent?.eventId ===
        updateScenarioDto.terminationEventId
      ) {
        await scenarioEventsRepo.update(
          {
            scenarioId: id,
            eventId: updateScenarioDto.terminationEventId,
            autoTerminationStatus: true,
          },
          { message: updateScenarioDto.terminationMessage },
        );
      } else if (updateScenarioDto.autoTerminationStatus) {
        const newTerminationEvent = scenarioEventsRepo.create({
          scenarioId: id,
          eventId: updateScenarioDto.terminationEventId,
          autoTerminationStatus: true,
          message: updateScenarioDto.terminationMessage,
        });
        scenarioEventsRepo.save(newTerminationEvent);
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
        const scenarioTenantRepo = entityManager.getRepository(ScenarioTenants);

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
      // Getting triggerWranings that need to be added
      const newTriggerWarningIds = !existingTriggerWarningIds
        ? updateScenarioDto?.triggerWarningIds
        : updateScenarioDto?.triggerWarningIds?.filter(
            (id) => !existingTriggerWarningIds?.includes(id),
          );
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

    return scenario;
  }

  async deleteAdminScenario(id: number): Promise<boolean> {
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
    });
    return true;
  }

  async mapEventsToScenario(createScenarioEventsDto: CreateScenarioEventsDto) {
    const { scenarioId, events } = createScenarioEventsDto;

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

    return await this.dataSource.transaction(async (entityManager) => {
      const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);

      // Delete existing non-auto-termination events for this scenario
      await scenarioEventsRepo.delete({
        scenarioId,
        autoTerminationStatus: false,
      });

      // Create an array of ScenarioEvents entities to be saved
      const scenarioEvents = events.map((event) => {
        const {
          id,
          feedbackStatus,
          score,
          emoji,
          message,
          branchingStatus,
          branchInstruction,
        } = event;
        return {
          scenarioId,
          eventId: id,
          autoTerminationStatus: false,
          score,
          ...(feedbackStatus
            ? {
                feedbackStatus,
                emoji,
                message,
              }
            : {
                feedbackStatus: false,
                emoji: undefined,
                message: undefined,
              }),
          ...(branchingStatus
            ? {
                branchingStatus,
                branchInstruction,
              }
            : {
                branchingStatus: false,
                branchInstruction: undefined,
              }),
        };
      });

      await scenarioEventsRepo.save(scenarioEvents);

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
        })),
      };
    });
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
    });
    if (result.affected === 0) {
      throw new BadRequestException('No scenario events found to delete');
    }
    return result.affected;
  }

  async getScenarioVoices(options: Pagination): Promise<ScenarioVoices[]> {
    return this.scenarioVoiceRepository.getScenarioVoices(options);
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
}
