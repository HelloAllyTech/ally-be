import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { TrackComponentTemplateService } from '../service/track-component-template.service';
import { TrackComponentTemplate } from '../entity/track-component-template.entity';
import { TrackItemType } from '../type/track.type';
import {
  CreateTrackComponentTemplateDto,
  GetTrackComponentTemplatesResponseDto,
  TrackComponentTemplateDto,
  UpdateTrackComponentTemplateDto,
} from '../dto/track-component-template.dto';
import { DeleteTrackComponentTemplatesDto } from '../dto/delete-track-component-templates.dto';

@ApiTags('Component Library')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin/component-templates')
export class TrackComponentTemplateController {
  constructor(
    private readonly templateService: TrackComponentTemplateService,
  ) {}

  @ApiOperation({
    summary:
      'List component templates with optional type filter, title search and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of component templates and total count',
    type: GetTrackComponentTemplatesResponseDto,
  })
  @ApiQuery({ name: 'type', required: false, enum: TrackItemType })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @Get()
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_ADMIN_TRACK],
  })
  async list(
    @Query('type') type?: TrackItemType,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<{ items: TrackComponentTemplate[]; total: number }> {
    return this.templateService.list({ type, search, limit, offset });
  }

  @ApiOperation({ summary: 'Get a component template by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the component template',
    type: TrackComponentTemplateDto,
  })
  @ApiParam({ name: 'id', required: true, type: String })
  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.VIEW_ADMIN_TRACK],
  })
  async getById(@Param('id') id: string): Promise<TrackComponentTemplate> {
    return this.templateService.getById(id);
  }

  @ApiOperation({ summary: 'Create a new component template' })
  @ApiResponse({
    status: 201,
    description: 'Returns the created component template',
    type: TrackComponentTemplateDto,
  })
  @Post()
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.EDIT_ADMIN_TRACK],
  })
  async create(
    @Body() dto: CreateTrackComponentTemplateDto,
  ): Promise<TrackComponentTemplate> {
    return this.templateService.create(dto);
  }

  @ApiOperation({ summary: 'Update an existing component template' })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated component template',
    type: TrackComponentTemplateDto,
  })
  @ApiParam({ name: 'id', required: true, type: String })
  @Put(':id')
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.EDIT_ADMIN_TRACK],
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTrackComponentTemplateDto,
  ): Promise<TrackComponentTemplate> {
    return this.templateService.update(id, dto);
  }

  @ApiOperation({ summary: 'Bulk delete component templates' })
  @ApiBody({ type: DeleteTrackComponentTemplatesDto })
  @ApiResponse({
    status: 200,
    description: 'Returns success status',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @Delete()
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.DELETE_ADMIN_TRACK],
  })
  async bulkDelete(
    @Body() dto: DeleteTrackComponentTemplatesDto,
  ): Promise<{ success: boolean }> {
    return this.templateService.bulkDelete(dto.ids);
  }

  @ApiOperation({ summary: 'Delete a component template' })
  @ApiResponse({
    status: 200,
    description: 'Returns success status',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiParam({ name: 'id', required: true, type: String })
  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.COMPONENT_LIBRARY, {
    permissions: [PERMISSIONS.DELETE_ADMIN_TRACK],
  })
  async delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.templateService.delete(id);
  }
}
