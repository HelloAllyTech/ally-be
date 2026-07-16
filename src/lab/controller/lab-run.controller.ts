import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { LabRunService } from '../service/lab-run.service';
import { CreateLabRunDto } from '../dto/lab-run.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import { LabRun } from '../entity/lab-run.entity';

@ApiTags('AI Lab - Runs')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/runs')
export class LabRunController {
  constructor(private readonly runService: LabRunService) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'List AI Lab runs (one row per skill execution)' })
  list(
    @Query() query: LabListQueryDto,
  ): Promise<{ items: LabRun[]; count: number }> {
    return this.runService.list(query);
  }

  @Get(':id')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'Get one AI Lab run by ID' })
  getById(@Param('id') id: string): Promise<LabRun> {
    return this.runService.getById(id);
  }

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary: 'Run a single skill with its variable values substituted in',
  })
  create(@Body() dto: CreateLabRunDto): Promise<LabRun> {
    return this.runService.create(dto);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_AI_LAB])
  @ApiOperation({ summary: 'Delete an AI Lab run from the log' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.runService.delete(id);
  }
}
