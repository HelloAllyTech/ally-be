import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PromptsService } from '../service/prompt.service';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
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

  @ApiOperation({ summary: 'Get all prompts' })
  @AuthPermissions([PERMISSIONS.VIEW_PROMPT])
  @Get('')
  async getPrompts(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('searchName') searchName?: string,
  ): Promise<PromptResponse[]> {
    return this.promptsService.getPrompts(searchName, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create new prompts' })
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @Post('')
  async createPrompts(
    @Body() createPromptsDto: CreatePromptsDto,
  ): Promise<Prompt[]> {
    return this.promptsService.createPrompts(createPromptsDto);
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
}
