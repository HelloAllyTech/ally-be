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
import { ExecutionManager } from 'src/common/execution/execution-manager';
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

interface ScenarioData {
  status?: ScenarioStatus;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  lifeHistory?: string;
  voiceId?: string;
  age?: number;
  gender?: string;
  currentLocation?: string;
  autoTerminationStatus?: boolean;
  terminationMessage?: string;
  terminationEventId?: string;
  [key: string]: any;
}

@Injectable()
export class ScenarioService {
  private readonly logger = LoggerService.getInstance(ScenarioService.name);

  constructor(
    private scenariosRepository: ScenariosRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private sessionEventService: SessionEventService,
    private scenarioVoiceRepository: ScenarioVoicesRepository,
    private s3Service: S3Service,
    private configService: AppConfigService,
    private dataSource: DataSource,
  ) {}

  async getScenarios(): Promise<Scenarios[]> {
    return this.scenariosRepository.find({
      select: [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
      ],
      where: {
        status: In([ScenarioStatus.ACTIVE, ScenarioStatus.COMING_SOON]),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async getAdminScenarios(status?: string, options?: Pagination) {
    const scenarios = await this.scenariosRepository.getAdminScenarios(
      status,
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

  async getAdminScenario(id: number): Promise<Scenarios> {
    const result = await this.scenariosRepository.getAdminScenarioById(id);

    if (!result) {
      throw new NotFoundException('Scenario not found');
    }

    // Extract name from terminationEventDetails and add to terminationEvent, then remove terminationEventDetails
    if (
      result &&
      (result as any).terminationEventDetails?.name &&
      (result as any).terminationEvent
    ) {
      (result as any).terminationEvent.name = (
        result as any
      ).terminationEventDetails.name;
      delete (result as any).terminationEventDetails;
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

        return {
          createdBy: userId,
          updatedBy: userId,
          title: scenario.title,
          scenario: '',
          description: scenario.description,
          coverImageUrl: scenario.coverImageUrl,
          coverVideoUrl: scenario.coverVideoUrl,
          status: scenario.status,
          prompt: scenario.prompt,
          metadata: {
            agentGoal: scenario.agentGoal,
            lifeHistory: scenario.lifeHistory,
            voiceId: scenario.voiceId,
            name: scenario.name,
            age: scenario.age,
            gender: scenario.gender,
            genderIdentity: scenario.genderIdentity,
            sexualOrientation: scenario.sexualOrientation,
            currentLocation: scenario.currentLocation,
            profession: scenario.profession,
            context: scenario.context,
            sessionBehaviorGuidelines: scenario.sessionBehaviorGuidelines,
            coreMemories: scenario.coreMemories,
            personality: scenario.personality,
            startingState: scenario.startingState,
            emotionalNeeds: scenario.emotionalNeeds,
            tone: scenario.tone,
            openingStatements: scenario.openingStatements,
          },
        };
      }),
    );

    const savedScenarios = await this.dataSource.transaction(
      async (entityManager) => {
        const scenariosRepo = entityManager.getRepository(Scenarios);
        const scenarioEventsRepo = entityManager.getRepository(ScenarioEvents);
        const scenarios = scenariosRepo.create(createScenarioDtos);
        const savedScenarios = await scenariosRepo.save(scenarios);

        // Map saved scenarios to their corresponding DTOs and create scenario events
        const scenarioTerminationEvents = scenarioEventsRepo.create(
          savedScenarios
            .map((savedScenario, index) => {
              const correspondingDto = createScenariosDto.scenarios[index];
              return {
                scenarioId: savedScenario.id,
                eventId: correspondingDto.terminationEventId,
                autoTerminationStatus: correspondingDto.autoTerminationStatus,
                message: correspondingDto.terminationMessage,
              };
            })
            .filter((event) => event.eventId && event.autoTerminationStatus), // Only create events if terminationEventId exists and autoTerminationStatus is true
        );

        if (scenarioTerminationEvents.length > 0) {
          await scenarioEventsRepo.save(scenarioTerminationEvents);
        }

        return savedScenarios;
      },
    );
    return savedScenarios;
  }

  async validateCreateScenario(
    createScenarioDto: CreateScenarioDto,
  ): Promise<void> {
    this.validateScenarioStatus(createScenarioDto);

    if (createScenarioDto.voiceId)
      await this.getScenarioVoice(createScenarioDto?.voiceId);
  }

  private validateScenarioStatus(data: ScenarioData): void {
    const { status, ...otherFields } = data;

    // Validate DRAFT: at least one field besides status must be provided
    if (status === ScenarioStatus.DRAFT) {
      const hasAtLeastOneField = Object.keys(otherFields).some(
        (key) => otherFields[key] !== undefined && otherFields[key] !== null,
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
        (field) => !data[field],
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

    const updatedScenario = await this.dataSource.transaction(
      async (entityManager) => {
        const updatedScenario = await entityManager
          .getRepository(Scenarios)
          .update(id, updateData);
        if (updateScenarioDto.autoTerminationStatus) {
          await entityManager.getRepository(ScenarioEvents).update(id, {
            autoTerminationStatus: updateScenarioDto.autoTerminationStatus,
            message: updateScenarioDto.terminationMessage,
          });
        } else {
          const scenarioTerminationEvent = await entityManager
            .getRepository(ScenarioEvents)
            .findOne({
              where: { scenarioId: id, autoTerminationStatus: true },
            });
          if (scenarioTerminationEvent) {
            await entityManager.getRepository(ScenarioEvents).delete({
              scenarioId: id,
              eventId: scenarioTerminationEvent.eventId,
              autoTerminationStatus: true,
            });
          }
        }
        return updatedScenario;
      },
    );
    return updatedScenario.affected !== 0;
  }

  async validateUpdateScenario(
    id: number,
    updateScenarioDto: UpdateScenarioDto,
  ): Promise<Scenarios> {
    const scenario = await this.scenariosRepository.findOne({ where: { id } });
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
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

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(Scenarios).softDelete(id);
      await em.getRepository(ScenarioEvents).softDelete({ scenarioId: id });
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
        tenantId: ExecutionManager.getTenantId(),
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

    // Save the scenario events to the database
    await this.scenarioEventsRepository.save(scenarioEvents);
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
