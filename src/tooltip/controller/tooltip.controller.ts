import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { TooltipService } from '../service/tooltip.service';
import { CreateTooltipDto } from '../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../dto/update-tooltip.dto';
import { Tooltip } from '../entity/tooltip.entity';
import { SortOrder } from 'src/common/type/common.type';

@ApiTags('Tooltip')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'tooltips',
  version: '1',
})
export class TooltipController {
  constructor(private readonly tooltipService: TooltipService) {}

  @ApiOperation({ summary: 'Get all tooltips' })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  @ApiQuery({ name: 'search', type: String, required: false, description: 'Search by location or tip text (case-insensitive)' })
  @ApiQuery({ name: 'sortBy', type: String, required: false, description: 'Sort column (createdAt | location)' })
  @ApiQuery({ name: 'order', enum: SortOrder, required: false, description: 'Sort order (ASC | DESC)' })
  @ApiResponse({ status: 200, description: 'Returns all tooltips', type: [Tooltip] })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_TOOLTIPS])
  @Get()
  async getTooltips(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
  ): Promise<Tooltip[]> {
    return this.tooltipService.getTooltips(search, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a tooltip' })
  @ApiBody({ type: CreateTooltipDto })
  @ApiResponse({ status: 201, description: 'Tooltip created successfully', type: Tooltip })
  @ApiResponse({ status: 409, description: 'A tooltip for this location already exists' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TOOLTIPS])
  @Post()
  async createTooltip(@Body() createTooltipDto: CreateTooltipDto): Promise<Tooltip> {
    return this.tooltipService.createTooltip(createTooltipDto);
  }

  @ApiOperation({ summary: 'Update a tooltip' })
  @ApiParam({ name: 'id', type: String, description: 'UUID of the tooltip to update' })
  @ApiBody({ type: UpdateTooltipDto })
  @ApiResponse({ status: 200, description: 'Tooltip updated successfully', type: Boolean })
  @ApiResponse({ status: 404, description: 'Tooltip not found' })
  @ApiResponse({ status: 409, description: 'A tooltip for this location already exists' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_TOOLTIPS])
  @Patch(':id')
  async updateTooltip(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTooltipDto: UpdateTooltipDto,
  ): Promise<boolean> {
    return this.tooltipService.updateTooltip(id, updateTooltipDto);
  }
}
