import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PromptsService } from '../service/prompt.service';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
import { SyncPromptsDto } from '../dto/sync-prompts.dto';
import { SortOrder } from 'src/user/enum/user.enum';
import { Prompt } from '../entity/prompt.entity';
import { PromptResponse } from '../type/prompt-response.type';

@ApiTags('Prompts')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'prompts',
  version: '1',
})
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  // ===== PROMPT ENDPOINTS =====

  @ApiOperation({
    summary: 'Get prompts by codes (e.g. for ally-ai-learn report)',
  })
  @UseGuards(ApiAuthGuard)
  @ApiSecurity('api-key')
  @Get('by-codes')
  async getPromptsByCodes(
    @Query('codes') codes: string,
  ): Promise<Record<string, string>> {
    const codeList = codes
      ? codes
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    if (codeList.length === 0) {
      return {};
    }
    return this.promptsService.getPromptsByCodes(codeList);
  }

  @ApiOperation({ summary: 'Get all prompts' })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get('')
  async getPrompts(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('searchName') searchName?: string,
    @Query('includeBlocks') includeBlocks?: string,
  ): Promise<PromptResponse[]> {
    const includeBlocksBool = includeBlocks !== 'false';
    return this.promptsService.getPrompts(searchName, includeBlocksBool, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({
    summary:
      'List prompt variants by promptType (e.g. main_agent) for the studio picker',
  })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get('by-type/:promptType')
  async getPromptsByType(
    @Param('promptType') promptType: string,
  ): Promise<PromptResponse[]> {
    return this.promptsService.getPromptsByType(promptType);
  }

  @ApiOperation({
    summary: 'Duplicate an existing prompt to start a new variant',
  })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Post(':id/duplicate')
  async duplicatePrompt(@Param('id') id: string): Promise<Prompt> {
    return this.promptsService.duplicatePrompt(id);
  }

  @ApiOperation({ summary: 'Create new prompts' })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Post('')
  async createPrompts(
    @Body() createPromptsDto: CreatePromptsDto,
  ): Promise<Prompt[]> {
    return this.promptsService.createPrompts(createPromptsDto);
  }

  @ApiOperation({
    summary:
      'Sync prompts from folder/codebase (add-only, update defaultPrompt)',
    description:
      'Accepts x-api-key for deployment scripts (e.g. ally-ai-learn sync).',
  })
  @UseGuards(ApiAuthGuard)
  @ApiSecurity('api-key')
  @Post('sync')
  async syncPrompts(
    @Body() syncPromptsDto: SyncPromptsDto,
  ): Promise<{ added: number; updated: number }> {
    return this.promptsService.syncPrompts(syncPromptsDto);
  }

  @ApiOperation({ summary: 'Update a prompt' })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Put(':id')
  async updatePrompt(
    @Param('id') id: string,
    @Body() updatePromptDto: UpdatePromptDto,
  ): Promise<boolean> {
    return this.promptsService.updatePrompt(id, updatePromptDto);
  }

  @ApiOperation({ summary: 'Revert prompt to codebase default' })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Post(':id/revert')
  async revertPrompt(@Param('id') id: string): Promise<boolean> {
    return this.promptsService.revertPrompt(id);
  }

  @ApiOperation({ summary: 'Delete an obsolete prompt' })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Delete(':id')
  async deleteObsoletePrompt(@Param('id') id: string): Promise<void> {
    return this.promptsService.deleteObsoletePrompt(id);
  }
}
