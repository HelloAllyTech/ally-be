import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 } from 'uuid';
import { DataSource, In, Not } from 'typeorm';

import { SessionEvents } from '../entity/session-events.entity';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { SessionEventRepository } from '../repository/session-event.repository';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import {
  CombinationExpressionRequestType,
  CombinationExpressionType,
  SessionEventDetectionType,
} from '../enum/session-event-detection.enum';
import {
  mapCreateEventDtoToDbEvent,
  mapUpdateEventDtoToDbEvent,
  extractEventIds,
  validateNoCycles,
} from '../util/session-event.util';
import {
  CombinationExpressionDto,
  CombinationExpressionRequestDto,
  CombinationExpressionResponseDto,
  CreateSessionEventDto,
  SessionEventResponseDto,
  UpdateSessionEventDto,
} from '../dto/session-event.dto';
import {
  MAX_COMBINATION_EVENT_DEPTH,
  SYSTEM_EVENT_DETECTION_TYPES,
} from '../constants/event.constant';

import { SessionEventTranslationService } from './session-event-translation.service';
@Injectable()
export class SessionEventService {
  constructor(
    private readonly sessionEventRepository: SessionEventRepository,
    private readonly dataSource: DataSource,
    private readonly sessionEventTranslationService: SessionEventTranslationService,
  ) {}

  async createSessionEvents(
    createEventDtos: CreateSessionEventDto[],
    userId: number,
  ): Promise<SessionEvents[]> {
    const events = createEventDtos.map((event) => ({
      id: v4(),
      ...(mapCreateEventDtoToDbEvent(event) || {}),
      createdBy: userId,
      updatedBy: userId,
    }));

    // Validate events
    await this.validateCreateSessionEvents(events);

    return this.sessionEventRepository.createSessionEvents(
      events as CreateSessionEventDto[],
    );
  }

  private async validateCreateSessionEvents(
    events: Partial<SessionEvents>[],
  ): Promise<void> {
    // Use Set for deduplication to avoid false validation failures
    const combinationExpressionEventIds = new Set<string>();

    for (const event of events) {
      if (
        event.detectionType === SessionEventDetectionType.COMBINATION &&
        event.id
      ) {
        await validateNoCycles(
          event.id,
          event.detectionData?.expression,
          this.sessionEventRepository,
        );

        const extractedIds = extractEventIds(event.detectionData?.expression);
        extractedIds.forEach((id) => combinationExpressionEventIds.add(id));
      }

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

    // Validate all referenced event IDs exist (only once, after collecting all)
    if (combinationExpressionEventIds.size > 0) {
      const eventDetails = await this.sessionEventRepository.findByIds(
        Array.from(combinationExpressionEventIds),
      );
      if (eventDetails?.length !== combinationExpressionEventIds.size) {
        throw new BadRequestException(
          'Invalid combination expression event IDs',
        );
      }
    }
  }

  async getSessionEventsByScenarioId(
    scenarioId: number,
  ): Promise<SessionEvents[]> {
    const events =
      await this.sessionEventRepository.getSessionEventsByScenarioId(
        scenarioId,
      );

    return events.map((event) => ({
      id: event.sessionEvents_id,
      name: event.sessionEvents_name,
      description: event.sessionEvents_description,
      score: event.scenarioEvents_score ?? event.sessionEvents_score,
      emoji:
        (event.scenarioEvents_feedbackStatus ?? true)
          ? event.scenarioEvents_emoji
          : event.sessionEvents_emoji,
      message:
        (event.scenarioEvents_feedbackStatus ?? true)
          ? event.scenarioEvents_message
          : event.sessionEvents_message,
      branchInstruction:
        (event.scenarioEvents_branchingStatus ?? true)
          ? (event.scenarioEvents_branchInstruction ??
            event.sessionEvents_branchInstruction)
          : null,
      detectionType: event.sessionEvents_detectionType,
      data: event.sessionEvents_detectionData,
      visibilityType: event.sessionEvents_visibilityType,
      feedbackStatus: event.scenarioEvents_feedbackStatus,
      speaker: event.sessionEvents_speaker,
      createdAt: event.sessionEvents_createdAt,
      updatedAt: event.sessionEvents_updatedAt,
      eventCode: event.sessionEvents_eventCode,
      checklistVisibilityStatus: event.scenarioEvents_checklistVisibilityStatus,
      detectionConfig:
        event.scenarioEvents_detectionConfig ||
        event.sessionEvents_detectionConfig
          ? {
              startTime:
                event.scenarioEvents_detectionConfig?.startTime ??
                event.sessionEvents_detectionConfig?.startTime,
              endTime:
                event.scenarioEvents_detectionConfig?.endTime ??
                event.sessionEvents_detectionConfig?.endTime,
              maxOccurrences:
                event.scenarioEvents_detectionConfig?.maxOccurrences ??
                event.sessionEvents_detectionConfig?.maxOccurrences,
              minGapTime:
                event.scenarioEvents_detectionConfig?.minGapTime ??
                event.sessionEvents_detectionConfig?.minGapTime,
              minScore:
                event.scenarioEvents_detectionConfig?.minScore ??
                event.sessionEvents_detectionConfig?.minScore,
              maxScore:
                event.scenarioEvents_detectionConfig?.maxScore ??
                event.sessionEvents_detectionConfig?.maxScore,
            }
          : undefined,
    }));
  }

  async updateSessionEvent(
    id: string,
    updateEventDto: UpdateSessionEventDto,
    userId: number,
  ): Promise<boolean> {
    const event = await this.sessionEventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException('Session Event not found');
    }
    if (SYSTEM_EVENT_DETECTION_TYPES.includes(event.detectionType)) {
      throw new BadRequestException('System events cannot be edited');
    }

    const formattedEventDto =
      mapUpdateEventDtoToDbEvent({
        ...updateEventDto,
        detectionType: event.detectionType,
      }) || {};

    // Validate no circular dependencies if updating a COMBINATION event
    if (event.detectionType === SessionEventDetectionType.COMBINATION) {
      await validateNoCycles(
        id,
        formattedEventDto?.detectionData?.expression,
        this.sessionEventRepository,
      );
    }

    const updated = await this.sessionEventRepository.update(id, {
      ...formattedEventDto,
      updatedBy: userId,
    });

    this.sessionEventTranslationService.createUpdateSessionEventTranslations([
      { ...formattedEventDto, id },
    ]);

    return updated.affected !== 0;
  }

  async findByIds(ids: string[]): Promise<SessionEvents[]> {
    if (!ids || ids.length === 0) {
      return [];
    }

    return this.sessionEventRepository.find({
      where: { id: In(ids) },
    });
  }

  async findSessionEventById(id: string): Promise<SessionEvents | null> {
    return this.sessionEventRepository.findOne({ where: { id } });
  }

  async getAllSessionEvents(
    visibilityType?: SessionEventVisibilityType,
    searchName?: string,
    pagination?: Pagination,
  ): Promise<{ data: SessionEventResponseDto[] }> {
    const sessionEvents = await this.sessionEventRepository.getAllSessionEvents(
      visibilityType,
      searchName,
      pagination,
    );

    const formattedSessionEvents = await Promise.all(
      sessionEvents.map(async (event) => {
        return {
          ...event,
          detectionData: event?.detectionData
            ? {
                ...event.detectionData,
                expression: await this.mapDbExpressionToResponse(
                  event?.detectionData?.expression as CombinationExpressionDto,
                ),
              }
            : undefined,
          isEditable: !SYSTEM_EVENT_DETECTION_TYPES.includes(
            event.detectionType,
          ),
        };
      }),
    );
    return { data: formattedSessionEvents };
  }

  async getSessionEventById(id: string): Promise<SessionEventResponseDto> {
    const event = await this.sessionEventRepository.findOne({ where: { id } });
    if (!event) {
      throw new NotFoundException('Session Event not found');
    }
    return {
      ...event,
      detectionData: event?.detectionData
        ? {
            ...event.detectionData,
            expression: await this.mapDbExpressionToResponse(
              event?.detectionData?.expression as CombinationExpressionDto,
            ),
          }
        : undefined,
      isEditable: !SYSTEM_EVENT_DETECTION_TYPES.includes(event.detectionType),
    };
  }

  async deleteSessionEvents(eventIds: string[]): Promise<boolean> {
    // Do not allow PASSIVE events and system events to be deleted
    const deletableEvents = await this.sessionEventRepository.find({
      select: ['id'],
      where: {
        id: In(eventIds),
        visibilityType: SessionEventVisibilityType.ACTIVE,
        detectionType: Not(In(SYSTEM_EVENT_DETECTION_TYPES)),
      },
    });

    const deletableEventsIds: string[] = deletableEvents.map(
      (event) => event.id,
    );
    if (deletableEventsIds.length === 0) {
      throw new BadRequestException(
        'Cannot delete: the specified events are either inactive or system-generated',
      );
    }

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(SessionEvents).softDelete({
        id: In(deletableEventsIds),
      });
      await em.getRepository(ScenarioEvents).softDelete({
        eventId: In(deletableEventsIds),
      });
    });
    return true;
  }

  /**
   * Gets immediate child event IDs from a combination event expression.
   * Note: This only returns direct children, not nested combination event dependencies.
   * Use getAllNestedEventsWithMap for recursive resolution.
   */
  async getImmediateEventIdsInCombinationExpression(
    eventId: string,
  ): Promise<string[]> {
    const event = await this.sessionEventRepository.findOne({
      where: { id: eventId },
    });
    if (!event) return [];
    return extractEventIds(event.detectionData?.expression);
  }

  /**
   * Recursively fetches all event IDs from a combination event,
   * including nested combination events, with depth limiting and batch fetching.
   *
   * @param eventId - The root combination event ID to start from
   * @param maxDepth - Maximum recursion depth (defaults to MAX_COMBINATION_EVENT_DEPTH)
   * @returns Object containing all unique event IDs and a map of eventId -> SessionEvents
   */
  async getAllNestedEventsWithMap(
    eventId: string,
    maxDepth: number = MAX_COMBINATION_EVENT_DEPTH,
  ): Promise<{
    eventIds: string[];
    eventsMap: Map<string, SessionEvents>;
  }> {
    const allEventIds = new Set<string>();
    const eventsMap = new Map<string, SessionEvents>();
    let toProcess: string[] = [eventId];
    let currentDepth = 0;

    while (toProcess.length > 0 && currentDepth < maxDepth) {
      // Filter out already processed IDs
      const idsToFetch = toProcess.filter((id) => !eventsMap.has(id));
      toProcess = [];

      if (idsToFetch.length === 0) break;

      // Batch fetch all events we need
      const events = await this.sessionEventRepository.find({
        where: { id: In(idsToFetch) },
      });

      for (const event of events) {
        eventsMap.set(event.id, event);

        // If it's a combination event, collect child IDs for next iteration
        if (event.detectionType === SessionEventDetectionType.COMBINATION) {
          const childIds = extractEventIds(event.detectionData?.expression);

          for (const childId of childIds) {
            allEventIds.add(childId);
            if (!eventsMap.has(childId)) {
              toProcess.push(childId);
            }
          }
        }
      }

      currentDepth++;
    }

    if (toProcess.length > 0 && currentDepth >= maxDepth) {
      throw new BadRequestException(
        `Maximum combination event depth (${maxDepth}) exceeded. This may indicate circular dependencies or overly complex event structures.`,
      );
    }

    return {
      eventIds: Array.from(allEventIds),
      eventsMap,
    };
  }

  /**
   * Translates passive session events and updates their translations.
   *
   * @returns {Promise<SuccessResponse>} - A success response object.
   */
  async translatePassiveSessionEvents(): Promise<SuccessResponse> {
    // Get all passive session events
    const passiveEvents = await this.sessionEventRepository.getAllSessionEvents(
      SessionEventVisibilityType.PASSIVE,
    );

    // Create or update translations for passive events
    this.sessionEventTranslationService.createUpdateSessionEventTranslations(
      passiveEvents,
    );

    return { success: true };
  }

  private async mapDbExpressionToResponse(
    expr: CombinationExpressionDto,
  ): Promise<CombinationExpressionResponseDto | undefined> {
    if (!expr) return undefined;

    switch (expr.type) {
      case CombinationExpressionType.IDENTIFIER:
        const event = await this.sessionEventRepository.findOne({
          where: { id: expr.id },
        });
        return { id: expr.id ?? '', name: event?.name ?? '' };

      case CombinationExpressionType.NOT:
        // convert operand -> left
        return {
          type: CombinationExpressionRequestType.NOT,
          left: await this.mapDbExpressionToResponse(
            expr.operand as CombinationExpressionDto,
          ),
        };

      case CombinationExpressionType.AND:
      case CombinationExpressionType.OR:
        return {
          type: expr.type as unknown as CombinationExpressionRequestType,
          left: await this.mapDbExpressionToResponse(
            expr.left as CombinationExpressionDto,
          ),
          right: await this.mapDbExpressionToResponse(
            expr.right as CombinationExpressionDto,
          ),
        } as CombinationExpressionRequestDto;

      default:
        throw new BadRequestException('Invalid combination expression');
    }
  }
}
