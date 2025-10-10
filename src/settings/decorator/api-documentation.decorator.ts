import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

export const GetSummaryFields = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get summary fields' }),
    ApiResponse({
      status: 200,
      description: 'Returns the summary fields configuration',
      type: [String],
    }),
  );

export const UpdateSummaryFields = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update summary fields' }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          hiddenFields: { type: 'array', items: { type: 'string' } },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Summary fields updated successfully',
    }),
  );

export const GetNudgeStatus = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get nudge status' }),
    ApiResponse({
      status: 200,
      description: 'Returns the nudge status',
    }),
  );

export const UpdateNudgeStatus = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update nudge status' }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          status: { type: 'boolean' },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Nudge status updated successfully',
    }),
  );

export const GetChatTypes = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get enabled chat types' }),
    ApiResponse({
      status: 200,
      description: 'Returns the enabled chat types',
    }),
  );

export const UpdateHiddenChatTypes = () =>
  applyDecorators(
    ApiOperation({ summary: 'Update hidden chat types' }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          hiddenChatTypes: { type: 'array', items: { type: 'string' } },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'Hidden chat types updated successfully',
    }),
  );
