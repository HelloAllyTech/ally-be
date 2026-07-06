import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  LlmModelInfo,
  LlmRuntime,
  getLlmModels,
} from '../constants/llm-model-registry.constants';

@ApiTags('LLM')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'llm', version: '1' })
export class LlmController {
  /**
   * Canonical list of selectable LLM models (the model registry). Optionally
   * filtered to a runtime so a UI only offers models that runtime can run.
   */
  @Get('models')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List available LLM models, optionally filtered by runtime.',
  })
  @ApiQuery({ name: 'runtime', required: false, enum: LlmRuntime })
  getModels(@Query('runtime') runtime?: LlmRuntime): LlmModelInfo[] {
    return getLlmModels(runtime);
  }
}
