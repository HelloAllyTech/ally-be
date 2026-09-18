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

    if (opportunity.builderSessionId) {
      return {
        sessionId: opportunity.builderSessionId,
        created: false,
        seedMessage: null,
      };
    }

    // Builder's own gate, enforced here because this route is gated on the ROADMAP's rules.
    // Calling BuilderSessionService straight from a roadmap endpoint would otherwise let a
    // roadmap manager start builds on an instance where Builder is switched off entirely.
    await this.assertBuilderAccess(userId);

    const session = await this.builderSessionService.createSession(userId, {
      title: this.seedTitle(opportunity.description),
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
      seedMessage: this.seedMessage(
        opportunity.description,
        opportunity.prd ?? null,
      ),
    };
  }

  /**
   * The opening brief, built server-side so it cannot drift from what the column stored.
   *
   * Labelled sections rather than raw concatenation: the interview's first job is to tell the
   * one-line ask apart from the detail already written down, and an unlabelled blob makes it
   * guess. The PRD heading is omitted entirely when there is no PRD — an empty "## PRD" reads to
   * the agent as "there is a PRD and it is empty", which is a different fact.
   */
  private seedMessage(description: string, prd: string | null): string {
    const parts = [
      'This is a product opportunity from the Ally roadmap. Interview me into a PRD for it.',
      `## Opportunity\n${description.trim()}`,
    ];
    if (prd?.trim()) parts.push(`## Existing PRD notes\n${prd.trim()}`);
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
