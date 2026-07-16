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
import { LabEvalService } from '../service/lab-eval.service';
import { CreateLabRunDto } from '../dto/lab-run.dto';
import { AssignRunDto, PublishRunDto } from '../dto/lab-eval.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import { LabRun } from '../entity/lab-run.entity';

@ApiTags('AI Lab - Runs')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/lab/runs')
export class LabRunController {
  constructor(
    private readonly runService: LabRunService,
    private readonly evalService: LabEvalService,
  ) {}

  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'List AI Lab runs (one row per skill execution)' })
  list(@Query() query: LabListQueryDto) {
    return this.runService.list(query);
  }

  // Declared before ':id' routes so 'assignments/...' never binds as an id.
  @Delete('assignments/:assignmentId')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary: 'Remove an (unsubmitted) evaluator assignment from a run',
  })
  removeAssignment(@Param('assignmentId') assignmentId: string) {
    return this.evalService.removeAssignment(assignmentId);
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

  @Post(':id/publish')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary:
      'Publish a completed run for human evaluation with its questions (>= 1)',
  })
  publish(@Param('id') id: string, @Body() dto: PublishRunDto) {
    return this.evalService.publish(id, dto);
  }

  @Get(':id/questions')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'Evaluation questions attached to a published run' })
  questions(@Param('id') id: string) {
    return this.evalService.getQuestions(id);
  }

  @Get(':id/assignments')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({ summary: 'Evaluator assignments of a published run' })
  assignments(@Param('id') id: string) {
    return this.evalService.listAssignments(id);
  }

  @Post(':id/assignments')
  @AuthPermissions([PERMISSIONS.EDIT_AI_LAB])
  @ApiOperation({
    summary: 'Assign a published run to evaluators (add-only, idempotent)',
  })
  assign(@Param('id') id: string, @Body() dto: AssignRunDto) {
    return this.evalService.assign(id, dto);
  }

  @Get(':id/results')
  @AuthPermissions([PERMISSIONS.VIEW_AI_LAB])
  @ApiOperation({
    summary:
      'Aggregated human-eval results (per question + record level) for a published run',
  })
  results(@Param('id') id: string) {
    return this.evalService.results(id);
  }

  @Delete(':id')
  @AuthPermissions([PERMISSIONS.DELETE_AI_LAB])
  @ApiOperation({ summary: 'Delete an AI Lab run from the log' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.runService.delete(id);
  }
}
