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
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
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
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'List AI Lab skills (system-prompt templates)' })
  list(
    @Query() query: LabListQueryDto,
  ): Promise<{ items: LabSkill[]; count: number }> {
    return this.skillService.list(query);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'Get one AI Lab skill by ID' })
  getById(@Param('id') id: string): Promise<LabSkill> {
    return this.skillService.getById(id);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({ summary: 'Create an AI Lab skill' })
  create(@Body() dto: CreateLabSkillDto): Promise<LabSkill> {
    return this.skillService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({ summary: 'Update an AI Lab skill' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLabSkillDto,
  ): Promise<LabSkill> {
    return this.skillService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_AI_LAB])
  @ApiOperation({ summary: 'Delete an AI Lab skill' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.skillService.delete(id);
  }
}
