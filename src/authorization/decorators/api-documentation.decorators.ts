import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

export const GetUserPermissions = () =>
  applyDecorators(
    ApiOperation({ summary: 'Get current user permissions' }),
    ApiResponse({
      status: 200,
      description: 'Successfully retrieved user permissions',
      schema: {
        type: 'array',
        items: { type: 'string' },
      },
    }),
  );
