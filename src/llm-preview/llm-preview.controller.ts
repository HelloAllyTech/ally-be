import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LlmPreviewResponse, LlmPreviewService } from './llm-preview.service';

@Controller('llm-preview')
@ApiTags('LLM Preview')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class LlmPreviewController {
  constructor(private readonly llmPreviewService: LlmPreviewService) {}

  /**
   * POST, not GET: this spends money at a third-party provider and is not
   * cacheable or safely retryable by an intermediary.
   *
   * Gated on EDIT_LANGUAGE rather than the read permission — VIEW_ADMIN_LANGUAGES
   * lets someone see the registry, but making outbound billed calls belongs with
   * whoever can change it.
   */
  @Post('model/:modelId')
  @Version('1')
  @ApiOperation({
    summary: 'Run a one-line test completion against a catalog model',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  async generateForModel(
    @Param('modelId', ParseUUIDPipe) modelId: string,
  ): Promise<LlmPreviewResponse> {
    return this.llmPreviewService.previewModel(modelId);
  }

  /** @deprecated llm_configs is being retired; use POST model/:modelId. */
  @Post('generate/:configId')
  @Version('1')
  @ApiOperation({
    summary: 'Run a one-line test completion against an LLM config',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  async generate(
    @Param('configId', ParseUUIDPipe) configId: string,
  ): Promise<LlmPreviewResponse> {
    return this.llmPreviewService.previewConfig(configId);
  }
}
