import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ImprovementOrchestratorService } from '../service/improvement-orchestrator.service';
import { RehearsalComparisonService } from '../service/rehearsal-comparison.service';
import { RehearsalService } from '../service/rehearsal.service';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import {
  ResolveImprovementRunDto,
  StartImprovementRunDto,
} from '../dto/improvement.dto';

@ApiTags('Roleplay Studio Auto-Improve')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio', version: '1' })
export class ImprovementController {
  constructor(
    private readonly improvementOrchestrator: ImprovementOrchestratorService,
    private readonly comparisonService: RehearsalComparisonService,
    private readonly rehearsalService: RehearsalService,
    private readonly rehearsalRunRepository: RehearsalRunRepository,
  ) {}

  @Post('specs/:specId/versions/:versionId/improvement-runs')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary:
      'Start an autonomous improve loop (rehearse → critique → apply → repeat)',
  })
  startImprovementRun(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: StartImprovementRunDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.improvementOrchestrator.startImprovementRun(
      specId,
      versionId,
      dto,
      user.id,
    );
  }

  @Get('specs/:specId/improvement-runs')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'List improvement runs for a spec' })
  listImprovementRuns(@Param('specId', ParseUUIDPipe) specId: string) {
    return this.improvementOrchestrator.listRuns(specId);
  }

  @Get('improvement-runs/:runId')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary: 'Run detail: rounds (scores + deltas) and proposals per round',
  })
  getImprovementRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.improvementOrchestrator.getRunDetail(runId);
  }

  @Get('improvement-runs/:runId/diff')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary: 'Cumulative changed-paths diff: base version vs best version',
  })
  getImprovementRunDiff(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.improvementOrchestrator.getRunDiff(runId);
  }

  @Post('improvement-runs/:runId/accept')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary: "Accept the run's best version — its spec becomes the draft",
  })
  acceptImprovementRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: ResolveImprovementRunDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.improvementOrchestrator.acceptRun(runId, dto, user.id);
  }

  @Post('improvement-runs/:runId/discard')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'Discard the run (scratch versions stay archived)' })
  discardImprovementRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.improvementOrchestrator.discardRun(runId, user.id);
  }

  @Post('improvement-runs/:runId/cancel')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'Cancel a running improvement loop' })
  cancelImprovementRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.improvementOrchestrator.cancelRun(runId, user.id);
  }

  @Get('rehearsals/:rehearsalId/comparison')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary:
      'Score deltas vs another rehearsal (?against=<rehearsalId>|previous). ' +
      '"previous" = the latest earlier COMPLETED run for the same spec.',
  })
  async compareRehearsals(
    @Param('rehearsalId', ParseUUIDPipe) rehearsalId: string,
    @Query('against') against = 'previous',
  ) {
    const run = await this.rehearsalService.getRehearsal(rehearsalId);
    let baseRun;
    if (against === 'previous') {
      baseRun = await this.rehearsalRunRepository
        .createQueryBuilder('run')
        .where('run.specId = :specId', { specId: run.specId })
        .andWhere('run.status = :status', {
          status: RehearsalStatus.COMPLETED,
        })
        .andWhere('run.createdAt < :createdAt', { createdAt: run.createdAt })
        .andWhere('run.id != :id', { id: run.id })
        .orderBy('run.createdAt', 'DESC')
        .getOne();
    } else {
      baseRun = await this.rehearsalService.getRehearsal(against);
    }
    if (!baseRun) {
      return { against: null, comparison: null };
    }
    return {
      against: {
        rehearsalId: baseRun.id,
        specVersionId: baseRun.specVersionId,
        createdAt: baseRun.createdAt,
      },
      comparison: this.comparisonService.compare(baseRun.results, run.results),
    };
  }
}
