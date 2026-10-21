import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';

import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { OpenBuilderSessionResponseDto } from '../dto/roadmap-response.dto';
import { BUILDER_SEED_TITLE_MAX } from '../constants/product-roadmap.constants';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import {
  BuilderHandoffSource,
  describeBuilderHandoff,
  renderBuilderHandoff,
} from '../util/roadmap-builder-handoff.util';

/**
 * "Open in Builder Agent" — hands an opportunity to the Builder agent as the opening brief of a
 * PRD interview.
 *
 * This REPLACES the old "generate a Claude Code prompt" flow, which produced text a human then
 * copied into a terminal themselves. The opportunity already holds the two things Builder's
 * interview asks for first (what the thing is, and whatever PRD detail exists), so handing them
 * over directly removes a copy-paste step and, more importantly, keeps the resulting build
 * attached to the opportunity that motivated it.
 *
 * WHAT THIS SERVICE DOES NOT DO: send the seeding message. The interview turn is a streaming
 * (SSE) call the browser has to own — it renders tokens as they arrive — so this creates the
 * session, stores the link and reports whether it was newly created. The client sends the seed
 * on `created: true` and only then. See the drawer for the other half.
 *
 * THE SEED IS NOT THE WHOLE HAND-OFF. The seed is one visible message; what the opportunity
 * actually carries — the copilot's brief and the filing interview — goes to the session as its
 * hand-off context (BuilderSession.handoffContext), which Builder renders into the interview's
 * cached system prefix on every turn. Not into the seed: Builder summarises the oldest turns of
 * a long interview, and a hand-off inside the first message would be summarised away with
 * them; and a transcript pasted into the admin's opening message is a wall of text in a feed
 * they have to read.
 */
@Injectable()
export class RoadmapBuilderService {
  private readonly logger = LoggerService.getInstance(
    RoadmapBuilderService.name,
  );

  constructor(
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly builderSessionService: BuilderSessionService,
    private readonly permissionsService: PermissionsService,
    private readonly featureToggleService: FeatureToggleService,
  ) {}

  /**
   * Resolve the Builder session for an opportunity, creating one on first use.
   *
   * IDEMPOTENT BY DESIGN. Pressing the button twice must not fork the work into two
   * half-answered interviews seeded from the same text, so an existing link short-circuits
   * before anything is created. The unique index on the column is the backstop for two presses
   * racing each other.
   */
  async openSession(
    userId: number,
    opportunityId: string,
  ): Promise<OpenBuilderSessionResponseDto> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    // Builder's own gate. The route now carries the same check, so this is the backstop for any
    // future caller that is not behind it: calling BuilderSessionService straight from roadmap
    // code must never start a build for someone without Builder access. Before the resume
    // short-circuit too, now that a resume can write to the session (below).
    await this.assertBuilderAccess(userId);

    const handoff = await this.handoffSource(opportunity);

    if (opportunity.builderSessionId) {
      await this.backfillHandoff(opportunity.builderSessionId, handoff);
      return {
        sessionId: opportunity.builderSessionId,
        created: false,
        seedMessage: null,
      };
    }

    const session = await this.builderSessionService.createSession(userId, {
      title: this.seedTitle(opportunity.description),
      handoffContext: this.handoffText(handoff),
    });

    // A concurrent press may have won: claim the column only while it is still null, and if we
    // lost, keep the winner and let ours be the orphan. An orphaned empty session is a row
    // nobody opens; two sessions racing for one column is a 500 in the drawer.
    //
    // IsNull(), NOT `builderSessionId: null`. TypeORM compiles a literal null in a criteria
    // object to `WHERE "builderSessionId" = NULL`, which is never true in SQL — so the claim
    // matched zero rows every time, every press fell into the "someone else won" branch below,
    // and the button forked a brand-new unseeded session on each click. Caught by clicking it
    // twice; the unit test could not see it because the mock returned affected: 1.
    const claimed = await this.opportunityRepository.update(
      { id: opportunityId, builderSessionId: IsNull() },
      { builderSessionId: session.id, updatedBy: userId },
    );
    if (!claimed.affected) {
      const current = await this.opportunityRepository.findOne({
        where: { id: opportunityId },
      });
      this.logger.warn(
        `[ROADMAP] Concurrent Builder session for opportunity ${opportunityId}; ` +
          `keeping ${current?.builderSessionId}, orphaning ${session.id}`,
      );
      return {
        sessionId: current?.builderSessionId ?? session.id,
        created: false,
        seedMessage: null,
      };
    }

    // Handing work to Builder IS starting it, so the board should say so
    // rather than leaving the row sitting in `new` while a build runs against
    // it. Only forward, and only from the two stages that precede development:
    // a row someone has already marked released or archived is not something
    // this should reopen.
    if (
      opportunity.stage === RoadmapOpportunityStage.NEW ||
      opportunity.stage === RoadmapOpportunityStage.PRIORITISED
    ) {
      await this.opportunityRepository.update(
        { id: opportunityId },
        {
          stage: RoadmapOpportunityStage.UNDER_DEVELOPMENT,
          updatedBy: userId,
        },
      );
    }

    this.logger.info(
      `[ROADMAP] Opened Builder session ${session.id} for opportunity ${opportunityId} by user ${userId}`,
    );
    return {
      sessionId: session.id,
      created: true,
      seedMessage: this.seedMessage(handoff),
    };
  }

  /**
   * The opportunity as Builder is handed it. The transcript is a read of its own because the
   * column is `select: false` — the board reads every card and has no use for it.
   */
  private async handoffSource(
    opportunity: RoadmapOpportunity,
  ): Promise<BuilderHandoffSource> {
    const withTranscript = await this.opportunityRepository.findOne({
      where: { id: opportunity.id },
      select: { id: true, interviewTranscript: true },
    });
    return {
      code: opportunity.code ?? null,
      description: opportunity.description,
      prd: opportunity.prd ?? null,
      brief: opportunity.brief ?? null,
      interviewTranscript: withTranscript?.interviewTranscript ?? null,
    };
  }

  /**
   * The rendered hand-off, or null when the opportunity carries nothing beyond its description
   * and PRD notes — a quick-add or a bug report. Those are already the seed, and Builder frames
   * a hand-off as "the admin has answered these once", which nothing here would be true of.
   */
  private handoffText(handoff: BuilderHandoffSource): string | null {
    const { hasBrief, interviewMessages } = describeBuilderHandoff(handoff);
    return hasBrief || interviewMessages ? renderBuilderHandoff(handoff) : null;
  }

  /**
   * Give a session opened before the hand-off existed the one it would have been created with.
   *
   * So pressing the button again on an opportunity whose interview is already under way gets
   * that interview the brief from its next turn — the transcript only exists for opportunities
   * filed since, so an older one gets the brief alone. Never replaces a hand-off already there
   * (it is frozen once written), and best-effort: the press is a request to OPEN the session,
   * and a failed write must not stand in the way of that.
   */
  private async backfillHandoff(
    sessionId: string,
    handoff: BuilderHandoffSource,
  ): Promise<void> {
    const text = this.handoffText(handoff);
    if (!text) return;
    try {
      const attached = await this.builderSessionService.attachHandoffContext(
        sessionId,
        text,
      );
      if (attached) {
        this.logger.info(
          `[ROADMAP] Attached the opportunity hand-off to existing Builder session ${sessionId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Could not attach the opportunity hand-off to Builder session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The opening brief, built server-side so it cannot drift from what the column stored.
   *
   * Labelled sections rather than raw concatenation: the interview's first job is to tell the
   * one-line ask apart from the detail already written down, and an unlabelled blob makes it
   * guess. The PRD heading is omitted entirely when there is no PRD — an empty "## PRD" reads to
   * the agent as "there is a PRD and it is empty", which is a different fact.
   *
   * It names what else came over and says it is settled, in the admin's voice since it is sent
   * as their message: the hand-off itself is invisible in the feed, so this line is how the admin
   * can see that the work they did filing it was passed on.
   */
  private seedMessage(handoff: BuilderHandoffSource): string {
    const parts = [
      'This is a product opportunity from the Ally roadmap. Interview me into a PRD for it.',
      `## Opportunity\n${handoff.description.trim()}`,
    ];
    if (handoff.prd?.trim()) {
      parts.push(`## Existing PRD notes\n${handoff.prd.trim()}`);
    }
    const { hasBrief, interviewMessages } = describeBuilderHandoff(handoff);
    const carried = [
      hasBrief ? "the opportunity copilot's brief" : null,
      interviewMessages
        ? `our ${interviewMessages}-message filing interview`
        : null,
    ].filter(Boolean);
    if (carried.length) {
      parts.push(
        `I filed this through the opportunity copilot, and ${carried.join(' and ')} ` +
          `${carried.length > 1 ? 'are' : 'is'} in your context under "Hand-off". What I ` +
          'decided there is settled — pick up from what it leaves open.',
      );
    }
    return parts.join('\n\n');
  }

  /**
   * Builder derives its branch slug from the session title, so this is the first line of the
   * description rather than the whole thing — a 1000-character description would produce a
   * branch name nobody can read. The agent renames the session as the PRD takes shape.
   */
  private seedTitle(description: string): string {
    const firstLine = description.trim().split('\n')[0].trim();
    return firstLine.slice(0, BUILDER_SEED_TITLE_MAX);
  }

  private async assertBuilderAccess(userId: number): Promise<void> {
    const [permissions, hasToggle] = await Promise.all([
      this.permissionsService.getUserPermissions(userId),
      this.featureToggleService.hasToggle(userId, FeatureToggleKey.BUILDER),
    ]);
    if (!hasToggle || !permissions.includes(PERMISSIONS.EDIT_BUILDER)) {
      throw new ForbiddenException(
        'Builder is not available for this account. It needs the Builder feature ' +
          'toggle and the Builder edit permission, which are granted separately from ' +
          'the roadmap.',
      );
    }
  }

  /**
   * Move opportunities whose Builder work has shipped to `released`.
   *
   * The roadmap asks Builder, rather than Builder writing here: the roadmap is
   * allowed to depend on Builder's services (this class already does), and the
   * reverse edge is the one the opportunity entity explicitly warns against.
   * So this polls, on the same tick as everything else.
   *
   * `shipped` is stricter than "the session finished": every pull request
   * merged AND deployed. A build can complete having written nothing, and a
   * merged pull request whose release failed is the exact state a person needs
   * to see rather than have marked done. `releasedAt` is stamped here because
   * this IS the transition into RELEASED, which is the only time that column
   * is written.
   *
   * Never downgrades and never touches an archived row. A stage a person set
   * by hand is theirs; this only moves work forward to a conclusion the
   * evidence already supports.
   */
  async reconcileShippedOpportunities(): Promise<void> {
    const candidates = await this.opportunityRepository.find({
      where: {
        builderSessionId: Not(IsNull()),
        stage: In([
          RoadmapOpportunityStage.NEW,
          RoadmapOpportunityStage.PRIORITISED,
          RoadmapOpportunityStage.UNDER_DEVELOPMENT,
        ]),
      },
      take: 100,
    });

    for (const opportunity of candidates) {
      try {
        const delivery = await this.builderSessionService.getDeliveryState(
          opportunity.builderSessionId!,
        );
        if (!delivery?.shipped) continue;

        await this.opportunityRepository.update(
          { id: opportunity.id },
          {
            stage: RoadmapOpportunityStage.RELEASED,
            releasedAt: new Date(),
          },
        );
        this.logger.info(
          `[ROADMAP] Opportunity ${opportunity.id} released: Builder session ${opportunity.builderSessionId} shipped ${delivery.pullRequestCount} pull request(s).`,
        );
      } catch (error) {
        this.logger.warn(
          `[ROADMAP] Could not settle opportunity ${opportunity.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
