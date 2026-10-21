import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { BUILDER_EVAL_GATED_PROMPT_CODES } from '../../constants/builder-eval-gate.constants';
import { BuilderEvalFixtureService } from '../service/builder-eval-fixture.service';
import { BuilderEvalService } from '../service/builder-eval.service';
import {
  CreateEvalFixtureDto,
  CreateEvalFixtureFromExportDto,
  CreateEvalFixtureFromSessionDto,
  ImportEvalFixturesDto,
  StartEvalSuiteDto,
  SubmitPromptCandidateDto,
  UpdateEvalFixtureDto,
} from '../dto/builder-eval.dto';

/**
 * Builder's replay eval: fixtures (recorded interviews with a checklist),
 * suites (fixtures run several times, optionally with a candidate prompt), and
 * the gate that publishes a Builder prompt change only when its suite passes.
 *
 * Everything is EDIT_BUILDER, reads included: a fixture is a production
 * admin's words, and the runs replay them.
 */
@ApiTags('Builder eval')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder/eval', version: '1' })
export class BuilderEvalController {
  constructor(
    private readonly fixtures: BuilderEvalFixtureService,
    private readonly evals: BuilderEvalService,
  ) {}

  @Get('gated-prompts')
  @AuthPermissions([PERMISSIONS.EDIT_PROMPT])
  @ApiOperation({
    summary: 'Prompt codes whose edits go live only through the eval gate',
  })
  gatedPrompts() {
    return { promptCodes: BUILDER_EVAL_GATED_PROMPT_CODES };
  }

  @Get('fixtures')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'List eval fixtures' })
  listFixtures() {
    return this.fixtures.list();
  }

  // Declared before `fixtures/:id` so the router does not read "export" as an id.
  @Get('fixtures/export')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Export fixtures (all, or ?ids=a,b) for another environment',
  })
  exportFixtures(@Query('ids') ids?: string) {
    return this.fixtures.exportFixtures(
      ids
        ? ids
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined,
    );
  }

  @Post('fixtures/import')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Import an export; fixtures are matched by name' })
  importFixtures(
    @Body() dto: ImportEvalFixturesDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.fixtures.importFixtures(dto.fixtures as any, user.id);
  }

  @Post('fixtures/from-session/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Save a Builder session as an eval fixture' })
  fixtureFromSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateEvalFixtureFromSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.fixtures.createFromSession(sessionId, dto, user.id);
  }

  @Post('fixtures/from-export')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Save a session exported from another environment as an eval fixture',
  })
  fixtureFromExport(
    @Body() dto: CreateEvalFixtureFromExportDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.fixtures.createFromExport(dto.session as any, dto, user.id);
  }

  @Post('fixtures')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Create a fixture directly (e.g. a seeded-defect PRD)',
  })
  createFixture(
    @Body() dto: CreateEvalFixtureDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.fixtures.create(
      {
        name: dto.name,
        kind: dto.kind,
        payload: dto.payload as any,
        notes: dto.notes,
      },
      user.id,
    );
  }

  @Get('fixtures/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'One fixture, with its payload' })
  getFixture(@Param('id', ParseUUIDPipe) id: string) {
    return this.fixtures.get(id);
  }

  @Patch('fixtures/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Edit a fixture: its checklist, notes, name or active flag',
  })
  updateFixture(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEvalFixtureDto,
  ) {
    return this.fixtures.update(id, dto as any);
  }

  @Delete('fixtures/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Delete a fixture and its runs' })
  async deleteFixture(@Param('id', ParseUUIDPipe) id: string) {
    await this.fixtures.remove(id);
    return { deleted: true };
  }

  @Post('suites')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Run fixtures on the live settings; runs in the background',
  })
  startSuite(@Body() dto: StartEvalSuiteDto, @CurrentUser() user: TokenUser) {
    return this.evals.startSuite({
      trigger: 'manual',
      fixtureIds: dto.fixtureIds,
      repetitions: dto.repetitions,
      ...(dto.validatedTurns !== undefined || dto.situationBrief !== undefined
        ? {
            overrides: {
              ...(dto.validatedTurns !== undefined
                ? { validatedTurns: dto.validatedTurns }
                : {}),
              ...(dto.situationBrief !== undefined
                ? { situationBrief: dto.situationBrief }
                : {}),
            },
          }
        : {}),
      userId: user.id,
    });
  }

  @Get('suites')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Recent suites, newest first' })
  listSuites(@Query('limit') limit?: string) {
    return this.evals.listSuites(limit ? Number(limit) : undefined);
  }

  @Get('suites/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'A suite with its runs' })
  getSuite(@Param('id', ParseUUIDPipe) id: string) {
    return this.evals.getSuite(id);
  }

  @Post('suites/:id/cancel')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Stop a running suite: unstarted runs are cancelled, a run in flight finishes',
  })
  cancelSuite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.evals.cancelSuite(id, user.id);
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'One run: gates, metrics, judge and the replay transcript',
  })
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.evals.getRun(id);
  }

  @Post('prompt-candidates')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER, PERMISSIONS.EDIT_PROMPT],
  })
  @ApiOperation({
    summary:
      'Propose a change to a gated Builder prompt; it is published only if its eval suite passes',
  })
  submitPromptCandidate(
    @Body() dto: SubmitPromptCandidateDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.evals.submitPromptCandidate(
      {
        promptCode: dto.promptCode,
        content: dto.content,
        ...(dto.provider !== undefined
          ? { provider: dto.provider || null }
          : {}),
        ...(dto.model !== undefined ? { model: dto.model || null } : {}),
        ...(dto.temperature !== undefined
          ? { temperature: dto.temperature }
          : {}),
      },
      user.id,
      { fixtureIds: dto.fixtureIds, repetitions: dto.repetitions },
    );
  }
}
