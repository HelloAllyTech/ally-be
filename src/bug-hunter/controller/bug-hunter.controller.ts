import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import {
  SUPER_ADMIN_ROLES,
  SUPER_DUPER_ADMIN_ROLES,
} from 'src/common/constants/user.constants';

import { BugHuntSweepService } from '../service/bug-hunt-sweep.service';
import { BugHunterService } from '../service/bug-hunter.service';
import {
  BugFindingEnrichment,
  BugFindingService,
} from '../service/bug-finding.service';
import { BugFixSessionService } from '../service/bug-fix-session.service';
import { BugHunterNotificationService } from '../service/bug-hunter-notification.service';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugHunterNotification } from '../entity/bug-hunter-notification.entity';
import {
  BugHunterSettingsDto,
  BugHuntEventDto,
  BugHuntRunDetailDto,
  BugHuntRunDto,
  TriggerBugHuntSweepDto,
  BugFindingDto,
  BugFindingDetailDto,
  ListBugHuntRunsResponseDto,
  ListBugFindingsQueryDto,
  ListBugFindingsResponseDto,
  UpdateBugHunterSettingsDto,
  AnswerBugFindingDto,
  EditBugFindingDescriptionDto,
  StartBugFixSessionDto,
  BugFixStepDto,
  BugHunterNotificationDto,
  ListBugHunterNotificationsQueryDto,
  ListBugHunterNotificationsResponseDto,
  SetBugFindingStageDto,
  BugFindingRefDto,
} from '../dto/bug-hunter.dto';
import {
  BUG_HUNT_SSE_PING_INTERVAL_MS,
  BUG_HUNT_SSE_POLL_INTERVAL_MS,
} from '../constants/bug-hunter.constants';
import { effectiveStage } from '../util/bug-finding-stage.util';

/**
 * The Bug Hunter HUMAN admin surface — settings (kill switch), run history,
 * and a live event stream. Gated `@RequireFeatureToggle`, same tier as
 * Analytics Suggestions: this controls something that writes into repos and
 * other teams' backlogs, not a fixed reviewed chart.
 *
 * The pipeline's own start/report/close calls live in
 * `BugHunterPipelineController` instead — `@RequireFeatureToggle` runs
 * `AuthGuard('jwt')` first, which requires a logged-in human, and the
 * `.claude/workflows/bug-hunt.mjs` pipeline is a machine caller with no user
 * session. Splitting the controller (not the module) keeps both auth models
 * on their own routes without mixing guards per-method.
 */
@ApiTags('Bug Hunter')
@Controller('v1/bug-hunter')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class BugHunterController {
  constructor(
    private readonly bugHuntSweepService: BugHuntSweepService,
    private readonly bugHunterService: BugHunterService,
    private readonly bugFindingService: BugFindingService,
    private readonly bugFixSessionService: BugFixSessionService,
    private readonly notificationService: BugHunterNotificationService,
  ) {}

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({ summary: 'Read the kill switch (super-duper-admin)' })
  @ApiResponse({ status: 200, type: BugHunterSettingsDto })
  async getSettings(): Promise<BugHunterSettingsDto> {
    return toSettingsDto(await this.bugHunterService.getSettings());
  }

  @Patch('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Change the kill switch mode (super-duper-admin)',
    description:
      'OFF blocks every trigger — nightly and on-demand alike — until moved ' +
      'off OFF. MANUAL and AI both let discovery run; only MANUAL gates the ' +
      'fix stage on an admin approving each finding first. The change itself ' +
      'is logged to the same event timeline as run activity.',
  })
  @ApiResponse({ status: 200, type: BugHunterSettingsDto })
  async updateSettings(
    @Body() body: UpdateBugHunterSettingsDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugHunterSettingsDto> {
    return toSettingsDto(
      await this.bugHunterService.setMode(body.mode, user.id),
    );
  }

  /**
   * READ-ONLY, and open to SUPER_ADMIN as well as SUPER_DUPER_ADMIN — unlike
   * every mutating endpoint on this controller.
   *
   * Bugs used to be visible on the product roadmap board, which SUPER_ADMINs can
   * see. Now that bugs are listed here and nowhere else, keeping this tier at
   * super-duper-admin would not have been "unchanged access", it would have
   * silently removed a whole class of item from what a SUPER_ADMIN can see.
   * Deciding what gets fixed stays super-duper-admin; knowing what is broken
   * does not.
   */
  @Get('findings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'The comprehensive bug table — every bug Bug Hunter knows about, from any source (super-admin+)',
    description:
      'Newest first. Defaults to every status; pass `status` to filter to one, ' +
      'or `all` explicitly. A human-reported bug appears here from the moment ' +
      "it's filed, even before any hunt run has triaged it — which is also why " +
      '`runId` exists: a sweep that re-triages such a bug stamps itself onto a ' +
      'row that may be weeks old, so ordering by discovery date cannot answer ' +
      '"what did that sweep find?" and this filter is what does.',
  })
  @ApiResponse({ status: 200, type: ListBugFindingsResponseDto })
  async listFindings(
    @Query() query: ListBugFindingsQueryDto,
  ): Promise<ListBugFindingsResponseDto> {
    const { items, count } = await this.bugFindingService.list({
      status: query.status && query.status !== 'all' ? query.status : undefined,
      source: query.source,
      repo: query.repo,
      runId: query.runId,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    const enriched = await this.bugFindingService.enrich(items);
    return { items: enriched.map(toFindingDto), count };
  }

  /**
   * Resolve a roadmap opportunity id to the bug it became.
   *
   * Exists purely for the redirect: `?opportunity=<id>` links to bugs are in
   * people's bookmarks, notifications and Slack scrollback, and bugs are no
   * longer shown on the roadmap board. Rather than 404 those links, the roadmap
   * drawer looks the id up here and sends the reader to the bug's Bug Hunter
   * drawer instead.
   *
   * Read-only, so the same SUPER_ADMIN reasoning as `listFindings` applies.
   *
   * Declared ABOVE `findings/:id` for legibility only — the paths differ in
   * segment count, so unlike the FastAPI trap in ally-ai there is no ordering
   * hazard here.
   */
  @Get('findings/by-reported-bug/:opportunityId')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'The bug finding behind a roadmap opportunity id, for the deep-link redirect (super-admin+)',
  })
  @ApiResponse({ status: 200, type: BugFindingRefDto })
  async getFindingByReportedBug(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
  ): Promise<BugFindingRefDto> {
    const finding =
      await this.bugFindingService.findByReportedBugId(opportunityId);
    // 200 with a null id, not 404: "this roadmap row has no bug finding" is a
    // real and expected answer (the inbox write is best-effort, and rows predate
    // the table), and the caller redirects either way.
    return { findingId: finding?.id ?? null };
  }

  /** Read-only, so the same SUPER_ADMIN reasoning as `listFindings` applies. */
  @Get('findings/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'One finding plus its event timeline, for the drawer (super-admin+)',
  })
  @ApiResponse({ status: 200, type: BugFindingDetailDto })
  async getFinding(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BugFindingDetailDto> {
    const finding = await this.bugFindingService.getOne(id);
    const events = await this.bugHunterService.listEventsForFinding(id);
    return this.toFindingDetailDto(finding, events);
  }

  @Post('findings/:id/fix-session')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'Start a fix session for one bug — the on-demand path (super-duper-admin)',
    description:
      'Dispatches a Claude Code fix session in the target repo for exactly ' +
      'this finding: it skips Discover and Verify (the bug is already known) ' +
      'and runs the Fix phase alone — regression test, minimal fix, green ' +
      'suite, PR, merge. Refused while Bug Hunter is OFF, and refused if a ' +
      'session is already in flight. `repo` is an override for the pipeline; ' +
      'the admin-facing flow omits it and Bug Hunter classifies which repo ' +
      'a repo-less finding belongs to itself. This does NOT deploy: releasing ' +
      'the merged fix is a separate, explicitly human step — see POST .../release.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async startFixSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StartBugFixSessionDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(
      await this.bugFixSessionService.start(id, user.id, body.repo),
    );
  }

  @Post('findings/:id/cancel-fix-session')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Stop a running fix session (super-duper-admin)',
    description:
      "The manual kill switch: a session the workflow's `timeout-minutes: " +
      '60` cap would otherwise let run to completion. Cancels the actual ' +
      'GitHub Actions run — real compute/token savings, not just a status ' +
      'change — and marks the finding CANCELLED, which is deliberately ' +
      'distinct from FAILED (the agent gave up on its own) so the table ' +
      'shows a human stopped this one. Valid only from QUEUED or FIXING. ' +
      'Best-effort on the GitHub side: if the run id has not been resolved ' +
      'yet, or GitHub refuses the cancel (e.g. the run finished a moment ' +
      'before the click landed), the finding still lands at CANCELLED — ' +
      'the point is to stop it progressing further here, which does not ' +
      "depend on GitHub's cancel succeeding. Like FAILED, a cancelled bug " +
      'can have a fresh fix session started for it.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async cancelFixSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(
      await this.bugFixSessionService.cancelFixSession(id, user.id),
    );
  }

  @Post('findings/:id/release')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Release a merged fix to production (super-duper-admin)',
    description:
      "Dispatches the deployable's production-release workflow at the next " +
      'patch version — for ally-be that means a production DB migration and an ' +
      'ECS rollout, for the frontends an S3/CloudFront deploy. This is the ' +
      'human gate on an LLM-authored diff reaching production, so the ' +
      'triggering admin is recorded in `releasedBy`. Valid from MERGED, or ' +
      'from RELEASE_FAILED to retry. The outcome is reconciled from the ' +
      'GitHub run a few minutes later, not known at call time.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async releaseFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(await this.bugFixSessionService.release(id, user.id));
  }

  /**
   * One finding → DTO, enrichment included. Every human-facing endpoint that
   * returns a single finding goes through here rather than calling
   * `toFindingDto` directly, so a row never loses its reporter block just
   * because it came back from a mutation instead of the list.
   */
  private async toDto(finding: BugFinding): Promise<BugFindingDto> {
    return toFindingDto(await this.bugFindingService.enrichOne(finding));
  }

  /**
   * The drawer needs to know not just the finding but whether the release
   * button applies to it — a judgement that depends on repo/file mapping and
   * on whether this environment has GitHub credentials at all, neither of
   * which the client can work out for itself.
   */
  private async toFindingDetailDto(
    finding: BugFinding,
    events: BugHuntEvent[],
  ): Promise<BugFindingDetailDto> {
    const [{ releasable, target, reason }, steps, enriched] = await Promise.all(
      [
        this.bugFixSessionService.releasability(finding),
        this.bugFindingService.listSteps(finding.id),
        this.bugFindingService.enrichOne(finding),
      ],
    );
    return {
      ...toFindingDto(enriched),
      events: events.map(toEventDto),
      steps: steps.map(toStepDto),
      releasable,
      releaseTarget: target,
      releaseBlockedReason: reason,
    };
  }

  @Patch('findings/:id/stage')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'Pin the coarse roadmap stage by hand, or return it to automatic (super-duper-admin)',
    description:
      "A bug's stage (New / Prioritised / In development / Released / Archived) is normally " +
      'DERIVED from its pipeline status and needs no maintenance. This exists for the bug ' +
      'that was fixed outside Bug Hunter altogether — a hand-written PR, a config change, a ' +
      'fix that rode along with unrelated work — where the pipeline never moved and the ' +
      'status therefore still says NEW. Pinning STICKS: later transitions no longer move the ' +
      'stage, because the admin who pinned it is the only party who knows about the ' +
      'out-of-band fix. Send `stage: null` to clear the pin and go back to deriving. ' +
      'Mutating, so unlike reading the table this stays super-duper-admin.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async setFindingStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetBugFindingStageDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(
      // `stage` absent and `stage: null` both mean "back to automatic". An
      // endpoint whose only field is optional would otherwise make an empty
      // body a silent no-op, and there is no other reading of it here.
      await this.bugFindingService.setStage(id, body.stage ?? null, user.id),
    );
  }

  @Post('findings/:id/approve')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Approve a Manual-mode finding for fixing (super-duper-admin)',
    description:
      'Only valid from PENDING_APPROVAL. The next hunt run for that repo — ' +
      'scheduled or on-demand — picks up every APPROVED finding in its Fix ' +
      'phase; this does not trigger a run itself.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async approveFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(await this.bugFindingService.approve(id, user.id));
  }

  @Post('findings/:id/reject')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'Decline to fix a finding — it will never be picked up (super-duper-admin)',
    description:
      'Valid from NEW or PENDING_APPROVAL. Terminal: rejected findings never re-enter the pipeline.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async rejectFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(await this.bugFindingService.reject(id, user.id));
  }

  @Patch('findings/:id/description')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      "Rewrite a bug's description before putting Bug Hunter on it (super-duper-admin)",
    description:
      "The description is the fix agent's entire brief — `buildFixSessionPrompt` " +
      'states the problem to it as nothing but this text, and the repo ' +
      'classifier reads it to decide which codebase the bug belongs to. So a ' +
      'vague human report or a rambling finder paragraph is an input-quality ' +
      'problem, and this is how an admin fixes it without rejecting the bug ' +
      'and re-filing a better one. Valid from exactly the statuses a fix ' +
      'session can be started from (see ' +
      'BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES) — not while one is in ' +
      'flight, and not once a fix is merged. Does NOT change the status: ' +
      'editing is not approving, and the admin still presses "Put me on it" ' +
      "afterwards. The finder's or reporter's original words are preserved in " +
      "`originalDescription`, and the rewrite is recorded on the finding's " +
      'own event timeline.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async editFindingDescription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EditBugFindingDescriptionDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(
      await this.bugFindingService.editDescription(
        id,
        body.description,
        user.id,
      ),
    );
  }

  @Post('findings/:id/answer')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: "Answer a finding's open escalation question (super-duper-admin)",
    description:
      'Only valid while the finding is NEEDS_INPUT. The fix agent may be ' +
      'actively polling for this (it waits up to a bounded timeout before ' +
      "giving up for now) — answering doesn't itself change the status; the " +
      'pipeline transitions it once it reads the answer.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async answerFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AnswerBugFindingDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return this.toDto(
      await this.bugFindingService.recordAnswer(id, body.answer, user.id),
    );
  }

  @Get('notifications')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      "Bug Hunter's inbox — everything it wants to tell you (super-duper-admin)",
    description:
      'The only channel Bug Hunter speaks on. It used to post escalations, run ' +
      'summaries and release outcomes to Slack; all of that lands here instead, ' +
      'so there is one place to look. Newest first, read and unread together. ' +
      '`unreadCount` drives the badge.',
  })
  @ApiResponse({ status: 200, type: ListBugHunterNotificationsResponseDto })
  async listNotifications(
    @Query() query: ListBugHunterNotificationsQueryDto,
  ): Promise<ListBugHunterNotificationsResponseDto> {
    const { items, unreadCount } = await this.notificationService.list(
      query.limit ?? 50,
      query.unreadOnly ?? false,
    );
    return { items: items.map(toNotificationDto), unreadCount };
  }

  @Post('notifications/:id/read')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Mark one notification read (super-duper-admin)',
    description:
      'Read is per-notification, not per-admin: a handful of people work this ' +
      'same queue, and something one of them has dealt with should stop ' +
      'shouting at the rest. Re-reading keeps the first reader on record.',
  })
  @ApiResponse({ status: 200, type: BugHunterNotificationDto })
  async markNotificationRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugHunterNotificationDto> {
    return toNotificationDto(
      await this.notificationService.markRead(id, user.id),
    );
  }

  @Post('notifications/read-all')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({ summary: 'Clear the badge (super-duper-admin)' })
  async markAllNotificationsRead(
    @CurrentUser() user: TokenUser,
  ): Promise<{ unreadCount: number }> {
    return this.notificationService.markAllRead(user.id);
  }

  @Post('runs/trigger')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Start a repo-wide sweep now (super-duper-admin)',
    description:
      'The missing half of the kill switch. Until this existed there was no ' +
      'way for a human to ask for a sweep at all: the trigger enum had a ' +
      '`scheduled` value with no producer, no cron existed, and the only ' +
      "route that started a run was api-key-only. Dispatches that repo's " +
      '`bug-hunt-sweep.yml`, which fetches the protocol from ' +
      '`GET pipeline/sweep-prompt`. Refused with a recorded `skipped_disabled` ' +
      'run while Bug Hunter is OFF, so pressing it off-duty leaves an audit ' +
      'trail rather than doing nothing visible. `deep` reads the whole repo ' +
      'instead of the last day of commits — far more expensive, so it is ' +
      'opt-in per sweep.',
  })
  @ApiResponse({ status: 200, type: BugHuntRunDto })
  async triggerSweep(
    @Body() body: TriggerBugHuntSweepDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugHuntRunDto | { skipped: true; reason: string }> {
    const run = await this.bugHuntSweepService.trigger(
      body.repo,
      user.id,
      body.deep ?? false,
    );
    if (!run) {
      return {
        skipped: true,
        reason:
          'Bug Hunter is off duty. Switch it to Checks-with-you or Works-solo first.',
      };
    }
    return toRunDto(run);
  }

  @Get('runs')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({ summary: 'Run history, newest first (super-duper-admin)' })
  @ApiResponse({ status: 200, type: ListBugHuntRunsResponseDto })
  async listRuns(
    @Query('limit') limit?: string,
  ): Promise<ListBugHuntRunsResponseDto> {
    const runs = await this.bugHunterService.listRuns(
      limit ? Number(limit) : undefined,
    );
    return { items: runs.map(toRunDto) };
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'One run plus its full event timeline (super-duper-admin)',
  })
  @ApiResponse({ status: 200, type: BugHuntRunDetailDto })
  async getRun(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BugHuntRunDetailDto> {
    const { run, events } = await this.bugHunterService.getRunWithEvents(id);
    return { ...toRunDto(run), events: events.map(toEventDto) };
  }

  @Get('runs/:id/stream')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      "Live event stream for one run (SSE: event / ping), for the admin tab's live run card",
  })
  async streamRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    // No in-process emitter exists — the pipeline runs as an external agent
    // and reports over POST /report — so this is a poll loop over
    // BugHuntEvent, not a subscription. Cheap: one run's event count is small
    // and the interval is a few seconds, matching the copilot stream's ping
    // cadence for a familiar feel in the admin tab.
    let cursor = new Date(0);

    while (!clientGone) {
      const events = await this.bugHunterService.listEventsSince(id, cursor);
      for (const event of events) {
        safeWrite('event', toEventDto(event));
        cursor = event.createdAt;
      }

      const run = await this.bugHunterService.getRun(id);
      if (run.status !== 'running') {
        safeWrite('done', { status: run.status });
        break;
      }

      safeWrite('ping', { at: new Date().toISOString() });
      await sleep(
        events.length
          ? BUG_HUNT_SSE_PING_INTERVAL_MS
          : BUG_HUNT_SSE_POLL_INTERVAL_MS,
      );
    }

    if (!res.writableEnded) res.end();
  }
}

export function toSettingsDto(row: BugHunterSettings): BugHunterSettingsDto {
  return {
    mode: row.mode,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * `row` may or may not have been through `BugFindingService.enrich`. The
 * enrichment fields are optional so the pipeline-facing mappers and the unit
 * tests can keep passing a plain entity; every human-facing endpoint enriches
 * first (see `toDto`), because `report` is the only thing distinguishing a real
 * user's bug report from an agent-found lint error now that bugs are not on the
 * roadmap board.
 *
 * `stage` is computed here rather than stored — see bug-finding-stage.util.ts.
 */
export function toFindingDto(
  row: BugFinding & Partial<BugFindingEnrichment>,
): BugFindingDto {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    source: row.source,
    title: row.title,
    description: row.description,
    originalDescription: row.originalDescription ?? null,
    descriptionEditedBy: row.descriptionEditedBy ?? null,
    descriptionEditedAt: row.descriptionEditedAt ?? null,
    file: row.file ?? null,
    symbol: row.symbol ?? null,
    evidence: row.evidence ?? null,
    severity: row.severity ?? null,
    proven: row.proven,
    touchesGuardedPath: row.touchesGuardedPath,
    reportedBugId: row.reportedBugId ?? null,
    status: row.status,
    stage: effectiveStage(row),
    stageIsAuto: row.stageOverride == null,
    stageOverriddenBy: row.stageOverriddenBy ?? null,
    stageOverriddenByName: row.stageOverriddenByName ?? null,
    stageOverriddenAt: row.stageOverriddenAt ?? null,
    report: row.report ?? null,
    prUrl: row.prUrl ?? null,
    escalationQuestion: row.escalationQuestion ?? null,
    escalationAnswer: row.escalationAnswer ?? null,
    escalationAnsweredBy: row.escalationAnsweredBy ?? null,
    escalationAnsweredAt: row.escalationAnsweredAt ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ?? null,
    sessionRunUrl: row.sessionRunUrl ?? null,
    sessionRunId: row.sessionRunId ?? null,
    releaseTag: row.releaseTag ?? null,
    releaseRunUrl: row.releaseRunUrl ?? null,
    releasedBy: row.releasedBy ?? null,
    releasedAt: row.releasedAt ?? null,
    cancelledBy: row.cancelledBy ?? null,
    cancelledAt: row.cancelledAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRunDto(row: BugHuntRun): BugHuntRunDto {
  return {
    id: row.id,
    trigger: row.trigger,
    repo: row.repo,
    status: row.status,
    finishedAt: row.finishedAt ?? null,
    foundCount: row.foundCount,
    autoMergedCount: row.autoMergedCount,
    prOpenedCount: row.prOpenedCount,
    dismissedCount: row.dismissedCount,
    totalTokenCostUsd: row.totalTokenCostUsd,
    cliReportedCostUsd: (row.metadata?.cliReportedCostUsd as number) ?? null,
    totalInputTokens: row.totalInputTokens ?? null,
    totalOutputTokens: row.totalOutputTokens ?? null,
    createdAt: row.createdAt,
  };
}

export function toStepDto(row: BugFinding): BugFixStepDto {
  return {
    id: row.id,
    stepIndex: row.stepIndex ?? 0,
    repo: row.repo ?? null,
    stepSummary: row.stepSummary ?? null,
    status: row.status,
    prUrl: row.prUrl ?? null,
    releaseTag: row.releaseTag ?? null,
    sessionRunUrl: row.sessionRunUrl ?? null,
    releaseRunUrl: row.releaseRunUrl ?? null,
  };
}

export function toNotificationDto(
  row: BugHunterNotification,
): BugHunterNotificationDto {
  return {
    id: row.id,
    findingId: row.findingId ?? null,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    level: row.level,
    title: row.title,
    body: row.body ?? null,
    readAt: row.readAt ?? null,
    readBy: row.readBy ?? null,
    createdAt: row.createdAt,
  };
}

export function toEventDto(row: BugHuntEvent): BugHuntEventDto {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    stage: row.stage,
    summary: row.summary,
    payload: row.payload ?? null,
    suggestionId: row.suggestionId ?? null,
    findingId: row.findingId ?? null,
    createdAt: row.createdAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
