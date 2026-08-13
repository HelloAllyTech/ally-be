import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { SUPER_ADMIN_ROLES } from '../../common/constants/user.constants';
import { LabValueService } from '../service/lab-value.service';
import { CreateLabValueDto, UpdateLabValueDto } from '../dto/lab-value.dto';
import { LabValueListQueryDto } from '../dto/lab-query.dto';
import { LabValue } from '../entity/lab-value.entity';

@ApiTags('AI Lab - Values')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/values')
export class LabValueController {
  constructor(private readonly valueService: LabValueService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({
    summary: 'List AI Lab values, optionally scoped to one variable',
  })
  list(
    @Query() query: LabValueListQueryDto,
  ): Promise<{ items: LabValue[]; count: number }> {
    return this.valueService.list(query);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Get one AI Lab value by ID' })
  getById(@Param('id') id: string): Promise<LabValue> {
    return this.valueService.getById(id);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({ summary: 'Create an AI Lab value bound to a variable' })
  create(@Body() dto: CreateLabValueDto): Promise<LabValue> {
    return this.valueService.create(dto);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({ summary: 'Update an AI Lab value' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLabValueDto,
  ): Promise<LabValue> {
    return this.valueService.update(id, dto);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.DELETE_AI_LAB],
  })
  @ApiOperation({ summary: 'Delete an AI Lab value' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.valueService.delete(id);
  }
}
