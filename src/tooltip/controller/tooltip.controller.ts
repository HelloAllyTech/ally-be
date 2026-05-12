import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { CreateTooltipDto } from '../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../dto/update-tooltip.dto';
import { TooltipService } from '../service/tooltip.service';

@ApiTags('Tooltips')
@Controller('v1/tooltips')
export class TooltipController {
  constructor(private readonly tooltipService: TooltipService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tooltips' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'order', required: false })
  @AuthPermissions([PERMISSIONS.VIEW_TOOLTIPS])
  async getTooltips(
    @Query('search') search?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'ASC' | 'DESC',
  ) {
    return this.tooltipService.getTooltips(search, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a tooltip' })
  @AuthPermissions([PERMISSIONS.EDIT_TOOLTIPS])
  async createTooltip(@Body() createDto: CreateTooltipDto) {
    return this.tooltipService.createTooltip(createDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tooltip' })
  @AuthPermissions([PERMISSIONS.EDIT_TOOLTIPS])
  async updateTooltip(
    @Param('id') id: string,
    @Body() updateDto: UpdateTooltipDto,
  ) {
    return this.tooltipService.updateTooltip(id, updateDto);
  }
}
