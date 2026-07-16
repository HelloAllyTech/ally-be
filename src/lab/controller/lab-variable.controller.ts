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
import { LabVariableService } from '../service/lab-variable.service';
import {
  CreateLabVariableDto,
  UpdateLabVariableDto,
} from '../dto/lab-variable.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import { LabVariable } from '../entity/lab-variable.entity';

@ApiTags('AI Lab - Variables')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/variables')
export class LabVariableController {
  constructor(private readonly variableService: LabVariableService) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'List AI Lab variables' })
  list(
    @Query() query: LabListQueryDto,
  ): Promise<{ items: LabVariable[]; count: number }> {
    return this.variableService.list(query);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'Get one AI Lab variable by ID' })
  getById(@Param('id') id: string): Promise<LabVariable> {
    return this.variableService.getById(id);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({ summary: 'Create an AI Lab variable (name must be unique)' })
  create(@Body() dto: CreateLabVariableDto): Promise<LabVariable> {
    return this.variableService.create(dto);
  }

  @Patch(':id')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({ summary: 'Update an AI Lab variable' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLabVariableDto,
  ): Promise<LabVariable> {
    return this.variableService.update(id, dto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_AI_LAB])
  @ApiOperation({
    summary: 'Delete an AI Lab variable (cascades to its values)',
  })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.variableService.delete(id);
  }
}
