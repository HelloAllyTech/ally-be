import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SimulationCreditsResponseDto } from '../dto/simulation-credits-response.dto';

export function GetSimulationCreditsDocumentation() {
  return applyDecorators(
    ApiOperation({ summary: 'Get simulation credits for a user' }),
    ApiResponse({
      status: 200,
      description: 'Simulation credits retrieved successfully',
      type: SimulationCreditsResponseDto,
    }),
  );
}

export function UpdateSimulationCreditsDocumentation() {
  return applyDecorators(
    ApiOperation({ summary: 'Update simulation credits for a user' }),
    ApiResponse({
      status: 200,
      description: 'Simulation credits updated successfully',
      type: Boolean,
    }),
    ApiResponse({
      status: 400,
      description:
        'Bad request - total credits cannot be less than consumed credits',
    }),
  );
}
