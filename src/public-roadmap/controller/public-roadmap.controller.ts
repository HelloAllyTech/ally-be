import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/auth/decorators/auth.metadata';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  CreatePublicRoadmapItemDto,
  GetPublicRoadmapResponseDto,
  PublicRoadmapItemDto,
  ReorderPublicRoadmapItemsDto,
  UpdatePublicRoadmapItemDto,
} from '../dto/public-roadmap-item.dto';
import { PublicRoadmapService } from '../service/public-roadmap.service';

/**
 * The public product roadmap (app.helloally.ai/blog/roadmap) and its editor,
 * the Roadmap tab of the admin console's Settings page. Writes carry the same
 * gate as that page's other global content (Terms, Privacy): the Settings
 * feature toggle plus system access.
 */
@ApiTags('Public Roadmap')
@Controller('v1/public-roadmap')
export class PublicRoadmapController {
  constructor(private readonly service: PublicRoadmapService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'The public product roadmap: every visible card (no auth required)',
  })
  @ApiResponse({ status: 200, type: GetPublicRoadmapResponseDto })
  getPublicRoadmap(): Promise<GetPublicRoadmapResponseDto> {
    return this.service.getPublicRoadmap();
  }

  @Get('items')
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  @ApiOperation({ summary: 'Every roadmap card, hidden ones included' })
  @ApiResponse({ status: 200, type: [PublicRoadmapItemDto] })
  listItems(): Promise<PublicRoadmapItemDto[]> {
    return this.service.listAll();
  }

  @Post('items')
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  @ApiOperation({ summary: 'Add a roadmap card (live on save unless hidden)' })
  @ApiResponse({ status: 201, type: PublicRoadmapItemDto })
  createItem(
    @Body() body: CreatePublicRoadmapItemDto,
  ): Promise<PublicRoadmapItemDto> {
    return this.service.create(body);
  }

  // Before 'items/:id', so 'order' is never read as an id.
  @Put('items/order')
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  @ApiOperation({
    summary: 'Reorder the cards in one category × stage cell, top to bottom',
  })
  @ApiResponse({ status: 200, type: [PublicRoadmapItemDto] })
  reorderItems(
    @Body() body: ReorderPublicRoadmapItemsDto,
  ): Promise<PublicRoadmapItemDto[]> {
    return this.service.reorder(body.ids);
  }

  @Patch('items/:id')
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  @ApiOperation({ summary: 'Edit, move or hide a roadmap card' })
  @ApiResponse({ status: 200, type: PublicRoadmapItemDto })
  updateItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePublicRoadmapItemDto,
  ): Promise<PublicRoadmapItemDto> {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS, {
    permissions: [PERMISSIONS.SYSTEM_ACCESS],
  })
  @ApiOperation({ summary: 'Delete a roadmap card' })
  deleteItem(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: boolean }> {
    return this.service.remove(id);
  }
}
