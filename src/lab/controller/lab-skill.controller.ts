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
import { LabSkillService } from '../service/lab-skill.service';
import { CreateLabSkillDto, UpdateLabSkillDto } from '../dto/lab-skill.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import { LabSkill } from '../entity/lab-skill.entity';

@ApiTags('AI Lab - Skills')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/skills')
export class LabSkillController {
  constructor(private readonly skillService: LabSkillService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'List AI Lab skills (system-prompt templates)' })
  list(
    @Query() query: LabListQueryDto,
  ): Promise<{ items: LabSkill[]; count: number }> {
    return this.skillService.list(query);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Get one AI Lab skill by ID' })
  getById(@Param('id') id: string): Promise<LabSkill> {
    return this.skillService.getById(id);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({ summary: 'Create an AI Lab skill' })
  create(@Body() dto: CreateLabSkillDto): Promise<LabSkill> {
    return this.skillService.create(dto);
  }

  @Patch(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({ summary: 'Update an AI Lab skill' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLabSkillDto,
  ): Promise<LabSkill> {
    return this.skillService.update(id, dto);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    legacyRoles: SUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.DELETE_AI_LAB],
  })
  @ApiOperation({ summary: 'Delete an AI Lab skill' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.skillService.delete(id);
  }
}
