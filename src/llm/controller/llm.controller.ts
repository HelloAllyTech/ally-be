import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  LlmModelInfo,
  LlmRuntime,
} from '../constants/llm-model-registry.constants';
import { AiTaskResponseDto } from '../dto/ai-task.dto';
import { CreateLlmModelDto, UpdateLlmModelDto } from '../dto/llm-model.dto';
import { LlmModels } from '../entity/llm-models.entity';
import { AiTaskService } from '../service/ai-task.service';
import { LlmModelService } from '../service/llm-model.service';

@ApiTags('LLM')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'llm', version: '1' })
export class LlmController {
  constructor(
    private readonly llmModelService: LlmModelService,
    private readonly aiTaskService: AiTaskService,
  ) {}

  /**
   * The AI task registry: every action on the platform that reaches a model over
   * an API, and which model serves it.
   *
   * Read-only and derived from code — there is nothing to edit here, which is
   * the point. The list lives in `ai-task-registry.constants.ts`; a call added
   * without a row there fails CI rather than quietly going unmapped.
   *
   * Gated on VIEW_ADMIN_LANGUAGES like the model catalog, since it describes the
   * same configuration surface from the other direction.
   */
  @Get('tasks')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @ApiOperation({
    summary:
      'List every AI/LLM call the platform makes and the model each one uses.',
  })
  getAiTasks(): AiTaskResponseDto[] {
    return this.aiTaskService.getTasks();
  }

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

  /**
   * The catalog as stored, inactive rows included, for the admin screen.
   *
   * Separate from GET /models because that one is the pickers' feed: it hides
   * inactive rows and falls back to the in-code list, neither of which an editor
   * should see.
   */
  @Get('catalog')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @ApiOperation({
    summary:
      'List every catalog row, including inactive ones. Optionally filtered to models a runtime can execute.',
  })
  @ApiQuery({ name: 'runtime', required: false, enum: LlmRuntime })
  async getCatalog(
    @Query('runtime') runtime?: LlmRuntime,
  ): Promise<LlmModels[]> {
    return this.llmModelService.getCatalog(runtime);
  }

  @Post('catalog')
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @ApiOperation({ summary: 'Add a model to the catalog.' })
  async createModel(@Body() dto: CreateLlmModelDto): Promise<LlmModels> {
    return this.llmModelService.createModel(dto);
  }

  @Patch('catalog/:id')
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @ApiOperation({ summary: 'Update a catalog model.' })
  async updateModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLlmModelDto,
  ): Promise<LlmModels> {
    return this.llmModelService.updateModel(id, dto);
  }

  @Delete('catalog/:id')
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @ApiOperation({ summary: 'Remove a model from the catalog.' })
  async deleteModel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: true }> {
    return this.llmModelService.deleteModel(id);
  }
}
