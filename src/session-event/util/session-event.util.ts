import { BadRequestException } from '@nestjs/common';
import {
  CombinationExpressionRequestDto,
  CreateSessionEventDto,
  DetectionConfigDto,
  DetectionDataDto,
  SessionEventDto,
  UpdateSessionEventDto,
} from '../dto/session-event.dto';
import { CombinationExpressionDto } from '../dto/session-event.dto';
import {
  CombinationExpressionRequestType,
  CombinationExpressionType,
  SessionEventDetectionType,
} from '../enum/session-event-detection.enum';
import { SessionEventRepository } from '../repository/session-event.repository';

export const mapRequestToDbExpression = (
  node: CombinationExpressionRequestDto,
): CombinationExpressionDto | undefined => {
  if (!node) return undefined;

  // Case 1: It's a simple event identifier
  if (node.id) {
    return {
      type: CombinationExpressionType.IDENTIFIER,
      id: node.id,
    };
  }
  const { type, left, right } = node;

  // Case 2: NOT - where left is considered the operand
  if (type === CombinationExpressionRequestType.NOT) {
    return {
      type: CombinationExpressionType.NOT,
      operand: mapRequestToDbExpression(
        left as CombinationExpressionRequestDto,
      ),
    };
  }

  // Case 3: AND / OR - where left and right are considered the operands
  if (
    type === CombinationExpressionRequestType.AND ||
    type === CombinationExpressionRequestType.OR
  ) {
    return {
      type: type as unknown as CombinationExpressionType,
      left: mapRequestToDbExpression(left as CombinationExpressionRequestDto),
      right: mapRequestToDbExpression(right as CombinationExpressionRequestDto),
    };
  }
  throw new BadRequestException('Invalid combination expression');
};

export const mapRequestToDbDetectionDataByType = (
  type: SessionEventDetectionType,
  eventDetectiondata: DetectionDataDto<CombinationExpressionRequestDto>,
): DetectionDataDto<CombinationExpressionDto> | undefined => {
  if (!eventDetectiondata) return undefined;
  const formattedExpression = mapRequestToDbExpression(
    eventDetectiondata?.expression as CombinationExpressionRequestDto,
  );
  switch (type) {
    case SessionEventDetectionType.SENTENCE_SIMILARITY:
      return {
        sentences: eventDetectiondata.sentences,
      };
    case SessionEventDetectionType.SEMANTIC_SIMILARITY:
      return {
        sentences: eventDetectiondata.sentences,
      };
    case SessionEventDetectionType.TIME:
      return {
        time: eventDetectiondata.time,
        condition: eventDetectiondata.condition,
      };
    case SessionEventDetectionType.SCORE:
      return {
        score: eventDetectiondata.score,
        condition: eventDetectiondata.condition,
      };
    case SessionEventDetectionType.COMBINATION:
      return {
        expression: formattedExpression,
      };
    case SessionEventDetectionType.BINARY_CLASSIFIER:
      return {
        className: eventDetectiondata.className,
        positiveExamples: eventDetectiondata.positiveExamples,
        negativeExamples: eventDetectiondata.negativeExamples,
      };
    case SessionEventDetectionType.HELPER_UTTERANCE_LENGTH:
      return {
        helperUtteranceLength: eventDetectiondata.helperUtteranceLength,
      };
    default:
      return undefined;
  }
};

export const mapRequestToDbDetectionConfigByType = (
  type: SessionEventDetectionType,
  detectionConfig: DetectionConfigDto,
): DetectionConfigDto | undefined => {
  if (!detectionConfig) return undefined;

  switch (type) {
    case SessionEventDetectionType.TIME:
      return {
        maxOccurrences: detectionConfig.maxOccurrences,
        minGapTime: detectionConfig.minGapTime,
        minScore: detectionConfig.minScore,
        maxScore: detectionConfig.maxScore,
      };
    case SessionEventDetectionType.SCORE:
      return {
        startTime: detectionConfig.startTime,
        endTime: detectionConfig.endTime,
        maxOccurrences: detectionConfig.maxOccurrences,
        minGapTime: detectionConfig.minGapTime,
      };
    default:
      return detectionConfig;
  }
};

export const mapCreateEventDtoToDbEvent = (
  event: CreateSessionEventDto,
): SessionEventDto<CombinationExpressionDto> => ({
  name: event.name,
  description: event.description,
  score: event.score,
  emoji: event.emoji,
  message: event.message,
  branchInstruction: event.branchInstruction,
  detectionType: event.detectionType,
  visibilityType: event.visibilityType,
  detectionData: mapRequestToDbDetectionDataByType(
    event.detectionType as SessionEventDetectionType,
    event.detectionData as DetectionDataDto<CombinationExpressionRequestDto>,
  ),
  detectionConfig: mapRequestToDbDetectionConfigByType(
    event.detectionType as SessionEventDetectionType,
    event.detectionConfig as DetectionConfigDto,
  ),
  tags: event.tags,
});

export const mapUpdateEventDtoToDbEvent = (
  event: UpdateSessionEventDto,
): SessionEventDto<CombinationExpressionDto> => ({
  name: event.name,
  description: event.description,
  score: event.score,
  emoji: event.emoji,
  message: event.message,
  branchInstruction: event.branchInstruction,
  visibilityType: event.visibilityType,
  detectionData: mapRequestToDbDetectionDataByType(
    event.detectionType as SessionEventDetectionType,
    event.detectionData as DetectionDataDto<CombinationExpressionRequestDto>,
  ),
  detectionConfig: mapRequestToDbDetectionConfigByType(
    event.detectionType as SessionEventDetectionType,
    event.detectionConfig as DetectionConfigDto,
  ),
  tags: event.tags,
});

/**
 * Extract all event IDs from a combination expression
 * Works with both request format (CombinationExpressionRequestDto) and DB format (CombinationExpressionDto)
 */
export const extractEventIds = (
  expression:
    | CombinationExpressionRequestDto
    | CombinationExpressionDto
    | undefined,
): string[] => {
  if (!expression) return [];

  const ids: string[] = [];

  // Handle identifier in DB format (has type field)
  if (
    'type' in expression &&
    expression.type === CombinationExpressionType.IDENTIFIER &&
    expression.id
  ) {
    ids.push(expression.id);
  }
  // Handle identifier in request format (direct id without type check)
  else if (expression.id && !('type' in expression)) {
    ids.push(expression.id);
  }

  // Recursively extract from left (used in AND, OR, and NOT)
  if (expression.left) {
    ids.push(...extractEventIds(expression.left));
  }

  // Recursively extract from right (used in AND, OR)
  if (expression.right) {
    ids.push(...extractEventIds(expression.right));
  }

  // Recursively extract from operand (used in NOT for DB format)
  if ('operand' in expression && expression.operand) {
    ids.push(...extractEventIds(expression.operand));
  }

  return ids;
};

export const getUniqueCombinationExpressionEventIdList = (
  createEventDtos: CreateSessionEventDto[],
): string[] => {
  const allIds: string[] = [];
  createEventDtos
    .filter(
      (event) =>
        event.detectionType === SessionEventDetectionType.COMBINATION &&
        event.detectionData?.expression,
    )
    .forEach((event) => {
      allIds.push(...extractEventIds(event.detectionData?.expression));
    });
  return Array.from(new Set(allIds));
};

/**
 * Validate that a combination event does not create circular dependencies
 * Uses depth-first search with recursion stack tracking to detect cycles
 */
export const validateNoCycles = async (
  eventId: string,
  expression: CombinationExpressionDto | undefined,
  sessionEventRepository: SessionEventRepository,
  maxDepth: number = 20,
): Promise<void> => {
  if (!expression) return;

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const checkCycle = async (
    currentEventId: string,
    expr: CombinationExpressionDto | undefined,
    depth: number,
  ): Promise<boolean> => {
    // Solution 2: Depth limit protection
    if (depth > maxDepth) {
      throw new BadRequestException(
        `Maximum dependency depth (${maxDepth}) exceeded. This may indicate a circular dependency or overly complex event structure.`,
      );
    }

    if (!expr) return false;

    // Mark current event as being processed in this recursion path
    recursionStack.add(currentEventId);
    visited.add(currentEventId);

    // Extract all referenced event IDs from the expression
    const referencedIds = extractEventIds(expr);

    for (const refId of referencedIds) {
      // Solution 1: Cycle detection - if we encounter an event already in the recursion stack, we have a cycle
      if (recursionStack.has(refId)) {
        throw new BadRequestException(
          `Circular dependency detected: Event '${currentEventId}' references '${refId}' which creates a cycle. Events cannot reference each other in a circular manner.`,
        );
      }

      // If not visited, recursively check this referenced event
      if (!visited.has(refId)) {
        const referencedEvent = await sessionEventRepository.findOne({
          where: { id: refId },
        });

        // Only check combination events for further dependencies
        if (
          referencedEvent?.detectionType ===
          SessionEventDetectionType.COMBINATION
        ) {
          const cycleFound = await checkCycle(
            refId,
            referencedEvent.detectionData?.expression,
            depth + 1,
          );
          if (cycleFound) return true;
        }
      }
    }

    // Remove from recursion stack after processing all dependencies
    recursionStack.delete(currentEventId);
    return false;
  };
  await checkCycle(eventId, expression, 0);
};
