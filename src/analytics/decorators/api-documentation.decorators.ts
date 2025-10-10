import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CounselorStatsResponseDto } from '../validation/analytics.validation';

export const GetCounselorStats = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Get counselor statistics',
      description:
        'Fetch counselor listening and sharing duration statistics with optional date range for the authenticated user',
    }),
    ApiResponse({
      status: 200,
      description: 'Counselor statistics retrieved successfully',
      type: [CounselorStatsResponseDto],
    }),
  );
