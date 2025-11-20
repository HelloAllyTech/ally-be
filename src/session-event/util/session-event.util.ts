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
