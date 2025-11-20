import { BadRequestException } from '@nestjs/common';
import {
  CombinationExpressionRequestDto,
  CreateSessionEventDto,
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

export const mapDbExpressionToResponse = (
  expr: CombinationExpressionDto,
): CombinationExpressionRequestDto | undefined => {
  if (!expr) return undefined;

  switch (expr.type) {
    case CombinationExpressionType.IDENTIFIER:
      return { id: expr.id ?? '' };

    case CombinationExpressionType.NOT:
      // convert operand -> left
      return {
        type: CombinationExpressionRequestType.NOT,
        left: mapDbExpressionToResponse(
          expr.operand as CombinationExpressionDto,
        ),
      };

    case CombinationExpressionType.AND:
    case CombinationExpressionType.OR:
      return {
        type: expr.type as unknown as CombinationExpressionRequestType,
        left: mapDbExpressionToResponse(expr.left as CombinationExpressionDto),
        right: mapDbExpressionToResponse(
          expr.right as CombinationExpressionDto,
        ),
      } as CombinationExpressionRequestDto;

    default:
      throw new BadRequestException('Invalid combination expression');
  }
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
    default:
      return undefined;
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
});

const extractEventIdsFromExpression = (
  expression: CombinationExpressionRequestDto | undefined,
): string[] => {
  if (!expression) return [];

  const ids: string[] = [];

  // If it's a simple identifier, add the id
  if (expression.id) {
    ids.push(expression.id);
  }
  // Recursively extract from left (used in AND, OR, and NOT)
  if (expression.left) {
    ids.push(...extractEventIdsFromExpression(expression.left));
  }
  // Recursively extract from right (used in AND, OR)
  if (expression.right) {
    ids.push(...extractEventIdsFromExpression(expression.right));
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
    ?.forEach((event) => {
      allIds.push(
        ...extractEventIdsFromExpression(event.detectionData?.expression),
      );
    }) ?? [];
  return Array.from(new Set(allIds));
};

/**
 * Extract all event IDs referenced in a combination expression tree
 */
export const extractEventIds = (
  expr: CombinationExpressionDto | undefined,
): string[] => {
  const ids: string[] = [];

  const traverse = (node: CombinationExpressionDto | undefined) => {
    if (!node) return;

    if (node.type === CombinationExpressionType.IDENTIFIER && node.id) {
      ids.push(node.id);
    }

    if (node.left) traverse(node.left);
    if (node.right) traverse(node.right);
    if (node.operand) traverse(node.operand);
  };

  traverse(expr);
  return ids;
};

/**
 * Validate that a combination event does not create circular dependencies
 * Uses depth-first search with recursion stack tracking to detect cycles
 *
 * @param eventId - The ID of the event being created/updated
 * @param expression - The combination expression to validate
 * @param sessionEventRepository - Repository to fetch referenced events
 * @param maxDepth - Maximum allowed dependency depth (default: 10)
 * @throws BadRequestException if a cycle is detected or max depth is exceeded
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
