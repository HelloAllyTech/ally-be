import { BadRequestException } from '@nestjs/common';
import { CombinationExpressionRequestDto } from '../dto/session-event.dto';
import { CombinationExpressionDto } from '../dto/session-event.dto';
import {
  CombinationExpressionRequestType,
  CombinationExpressionType,
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
