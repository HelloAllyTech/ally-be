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
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { LabRunService } from '../service/lab-run.service';
import { LabEvalService } from '../service/lab-eval.service';
import { LabAutoEvalService } from '../service/lab-auto-eval.service';
import { CreateLabRunDto } from '../dto/lab-run.dto';
import { AssignRunDto, PublishRunDto } from '../dto/lab-eval.dto';
import { CreateAutoEvalDto } from '../dto/lab-auto-eval.dto';
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
    private readonly autoEvalService: LabAutoEvalService,
  ) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'List AI Lab runs (one row per skill execution)' })
  list(@Query() query: LabListQueryDto) {
    return this.runService.list(query);
  }

  // Declared before ':id' routes so 'assignments/...' never binds as an id.
  @Delete('assignments/:assignmentId')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary: 'Remove an (unsubmitted) evaluator assignment from a run',
  })
  removeAssignment(@Param('assignmentId') assignmentId: string) {
    return this.evalService.removeAssignment(assignmentId);
  }

  @Get(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Get one AI Lab run by ID' })
  getById(@Param('id') id: string): Promise<LabRun> {
    return this.runService.getById(id);
  }

  @Post()
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary: 'Run a single skill with its variable values substituted in',
  })
  create(@Body() dto: CreateLabRunDto): Promise<LabRun> {
    return this.runService.create(dto);
  }

  @Post(':id/publish')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary:
      'Publish a completed run for human evaluation with its questions (>= 1)',
  })
  publish(@Param('id') id: string, @Body() dto: PublishRunDto) {
    return this.evalService.publish(id, dto);
  }

  @Get(':id/questions')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Evaluation questions attached to a published run' })
  questions(@Param('id') id: string) {
    return this.evalService.getQuestions(id);
  }

  @Get(':id/assignments')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Evaluator assignments of a published run' })
  assignments(@Param('id') id: string) {
    return this.evalService.listAssignments(id);
  }

  @Post(':id/assignments')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary: 'Assign a published run to evaluators (add-only, idempotent)',
  })
  assign(@Param('id') id: string, @Body() dto: AssignRunDto) {
    return this.evalService.assign(id, dto);
  }

  @Get(':id/results')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({
    summary:
      'Aggregated human-eval results (per question + record level) for a published run',
  })
  results(@Param('id') id: string) {
    return this.evalService.results(id);
  }

  @Get(':id/auto-evaluations')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.VIEW_AI_LAB],
  })
  @ApiOperation({ summary: 'Automated (LLM-judge) evaluations of a run' })
  autoEvaluations(@Param('id') id: string) {
    return this.autoEvalService.listForRun(id);
  }

  @Post(':id/auto-evaluations')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.EDIT_AI_LAB],
  })
  @ApiOperation({
    summary:
      "Score a completed run's output against a rubric with an LLM judge",
  })
  autoEvaluate(@Param('id') id: string, @Body() dto: CreateAutoEvalDto) {
    return this.autoEvalService.evaluate(id, dto);
  }

  @Delete(':id')
  @RequireFeatureToggle(FeatureToggleKey.AI_LAB, {
    permissions: [PERMISSIONS.DELETE_AI_LAB],
  })
  @ApiOperation({ summary: 'Delete an AI Lab run from the log' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.runService.delete(id);
  }
}
