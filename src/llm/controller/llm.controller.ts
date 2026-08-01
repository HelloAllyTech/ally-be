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
} from '../constants/llm-model-registry.constants';
import { LlmModelService } from '../service/llm-model.service';

@ApiTags('LLM')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'llm', version: '1' })
export class LlmController {
  constructor(private readonly llmModelService: LlmModelService) {}

  /**
   * Canonical list of selectable LLM models (the model registry). Optionally
   * filtered to a runtime so a UI only offers models that runtime can run.
   *
   * Backed by the `llm_models` table since the catalog moved to the database,
   * with the in-code list as a fallback. The response shape is unchanged, so no
   * client needed to change.
   */
  @Get('models')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List available LLM models, optionally filtered by runtime.',
  })
  @ApiQuery({ name: 'runtime', required: false, enum: LlmRuntime })
  async getModels(
    @Query('runtime') runtime?: LlmRuntime,
  ): Promise<LlmModelInfo[]> {
    return this.llmModelService.getModels(runtime);
  }
}
