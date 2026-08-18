import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { User } from 'src/user/entity/user.entity';
import { SUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import {
  BugFindingSource,
  BugFindingStatus,
} from 'src/bug-hunter/enum/bug-finding.enum';

import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import {
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import {
  RoadmapOpportunityRepository,
  RoadmapOpportunityRow,
} from '../repository/roadmap-opportunity.repository';
import { CONSUMER_BUG_REPORT_PRODUCT_GOAL } from '../constants/product-roadmap.constants';
import {
  CreateConsumerBugReportDto,
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
  UpdateOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  GetOpportunitiesResponseDto,
  OpportunityResponseDto,
  RoadmapEligibleOwnerDto,
  RoadmapFacetsDto,
  RoadmapUserRefDto,
} from '../dto/roadmap-response.dto';
import { currentPeriodKey } from '../util/roadmap-period.util';
import { effectiveMonthOf, isMonthPinned } from '../util/roadmap-month.util';
import { RoadmapVectorService } from './roadmap-vector.service';
import { RoadmapNotificationService } from './roadmap-notification.service';

/** Fields whose change requires re-embedding. `prd` and `owner` deliberately do not. */
const REINDEX_TRIGGERING_FIELDS: (keyof UpdateOpportunityDto)[] = [
  'description',
  'productGoal',
];

@Injectable()
export class RoadmapOpportunityService {
  private readonly logger = LoggerService.getInstance(
    RoadmapOpportunityService.name,
  );

  constructor(
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly vectorService: RoadmapVectorService,
    private readonly notifications: RoadmapNotificationService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(BugFinding)
    private readonly bugFindingRepository: Repository<BugFinding>,
  ) {}

  async list(
    userId: number,
    query: ListOpportunitiesQueryDto,
  ): Promise<GetOpportunitiesResponseDto> {
    const periodKey = currentPeriodKey();
    const result = await this.opportunityRepository.listOpportunities({
      ...query,
      userId,
      periodKey,
    });
    return {
      items: await this.toResponseList(result.items),
      count: result.count,
      maxScore: result.maxScore,
      // The client must never derive the period itself — see SetAllocationDto.
      periodKey,
    };
  }

  async findOne(userId: number, id: string): Promise<OpportunityResponseDto> {
    const row = await this.opportunityRepository.findOneWithScore(
      id,
      userId,
      currentPeriodKey(),
    );
    if (!row) throw new NotFoundException(`Opportunity ${id} not found`);
    return (await this.toResponseList([row]))[0];
  }

  /**
   * `extra` carries the fields the staff-facing CreateOpportunityDto has no reason to
   * expose — see createConsumerBugReport, its only other caller. Left undefined, every
   * field defaults exactly to what the pre-existing staff path always wrote (source
   * 'staff', tenantId/reporterContext null), so this is a no-op change for that caller.
   */
  async create(
    userId: number,
    dto: CreateOpportunityDto,
    extra?: {
      source?: RoadmapOpportunitySource;
      tenantId?: string | null;
      reporterContext?: Record<string, any> | null;
    },
  ): Promise<OpportunityResponseDto> {
    const saved = await this.opportunityRepository.save(
      this.opportunityRepository.create({
        description: dto.description.trim(),
        type: dto.type,
        productGoal: dto.productGoal,
        createdBy: userId,
        updatedBy: userId,
        source: extra?.source ?? RoadmapOpportunitySource.STAFF,
        tenantId: extra?.tenantId ?? null,
        reporterContext: extra?.reporterContext ?? null,
      }),
    );

    // Best-effort and awaited: the row is already committed, so a vector failure cannot roll
    // it back, but awaiting means the very next duplicate check sees this opportunity.
    await this.vectorService.indexQuietly(saved.id);

    // Bug Hunter's comprehensive findings table is a complete bug inbox — a human report
    // needs a row there the moment it's filed, not only once a hunt run gets around to
    // triaging it. Best-effort: a failure here must never fail the roadmap write that
    // already committed. See BugHunterModule's doc for why this is a raw repository
    // injection rather than a call into BugHunterModule (avoids a circular import).
    if (dto.type === RoadmapOpportunityType.BUG) {
      try {
        await this.bugFindingRepository.save(
          this.bugFindingRepository.create({
            source: BugFindingSource.REPORTED_BUG,
            title: saved.description.slice(0, 200),
            description: saved.description,
            reportedBugId: saved.id,
            status: BugFindingStatus.NEW,
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create a Bug Hunter finding for opportunity ${saved.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const response = await this.findOne(userId, saved.id);
    this.notifications.emit({
      kind: 'OPPORTUNITY_UPSERTED',
      actorId: userId,
      opportunity: response,
    });
    return response;
  }

  /**
   * POST /product-roadmap/bug-reports — a logged-in consumer app user (web/mobile/helpline)
   * filing a bug, through the exact same create() pipeline a staff-filed bug uses (vector
   * indexing, the Bug Hunter inbox row, the realtime notify). Only what differs from the
   * staff path is made explicit here: `type` is forced to BUG, `productGoal` is the fixed
   * consumer bucket (see CONSUMER_BUG_REPORT_PRODUCT_GOAL), and `source`/`tenantId`/
   * `reporterContext` are stamped so admins can tell a consumer report apart from a staff
   * one. Returns the minimal one-time confirmation, not the full opportunity — a consumer
   * has no further use for roadmap-internal fields like productGoal or boardPosition.
   */
  async createConsumerBugReport(
    userId: number,
    tenantId: string | null,
    dto: CreateConsumerBugReportDto,
  ): Promise<{ id: string; stage: RoadmapOpportunityStage }> {
    const created = await this.create(
      userId,
      {
        description: dto.description,
        type: RoadmapOpportunityType.BUG,
        productGoal: CONSUMER_BUG_REPORT_PRODUCT_GOAL,
      },
      {
        source: RoadmapOpportunitySource.CONSUMER,
        tenantId,
        reporterContext: dto.context ?? null,
      },
    );
    return { id: created.id, stage: created.stage };
  }

  /**
   * Update. Gated on edit:admin:product-roadmap at the controller, which means the author
   * cannot edit their own opportunity unless they also hold edit: — a faithful port of the
   * source's RLS (UPDATE was admin-only). Flagged in the DTO docblock.
   */
  async update(
    userId: number,
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<OpportunityResponseDto> {
    const existing = await this.opportunityRepository.findOne({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Opportunity ${id} not found`);

    const patch: Partial<RoadmapOpportunity> = { updatedBy: userId };
    if (dto.description !== undefined)
      patch.description = dto.description.trim();
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.productGoal !== undefined) patch.productGoal = dto.productGoal;
    if (dto.ownerUserId !== undefined) {
      // ONE representation is written, never both. `owner` is a text FK into
      // roadmap_opportunity_owners(name), so copying the Ally user's name into it fails the
      // constraint unless that person also exists as a taxonomy row — and inventing taxonomy rows
      // to mirror user accounts is exactly the hand-maintained list this change removes.
      //
      // So: `ownerUserId` is the assignment and `owner` stays purely legacy — only ever set by the
      // Supabase migration. Reads COALESCE the two, and the owner-name filter matches either, so a
      // migrated saved view keeps working after its owner is linked to a real account.
      patch.ownerUserId = dto.ownerUserId ?? null;
      if (dto.ownerUserId !== null) {
        await this.assertEligibleOwner(dto.ownerUserId);
      } else {
        // Un-assigning must also clear a legacy string, or the row would keep displaying a name
        // for an opportunity nobody owns.
        patch.owner = null;
      }
    }
    if (dto.prd !== undefined) patch.prd = dto.prd ?? null;
    if (dto.claudePrompt !== undefined)
      patch.claudePrompt = dto.claudePrompt ?? null;

    if (dto.stage !== undefined) {
      patch.stage = dto.stage;
      patch.releasedAt = this.resolveReleasedAt(existing, dto.stage);
    }

    if (
      dto.plannedMonth !== undefined &&
      dto.plannedMonth !== (existing.plannedMonth ?? null)
    ) {
      // A shipped card's lane is a fact, not a plan — the same rule the board enforces on drag,
      // checked here so the drawer cannot route around it. Evaluated against the stage the row
      // is ENDING UP in, so scheduling and releasing in one PATCH is judged on the outcome. Only
      // guards an actual change: the drawer always resends the existing plannedMonth alongside an
      // unrelated stage edit, and that carried-over value must not trip this check.
      const nextStage = patch.stage ?? existing.stage;
      const nextReleasedAt =
        patch.releasedAt !== undefined ? patch.releasedAt : existing.releasedAt;
      if (isMonthPinned(nextStage, nextReleasedAt)) {
        throw new UnprocessableEntityException(
          'A released opportunity sits in the month it shipped. Change its stage first to plan it into a different month.',
        );
      }
      patch.plannedMonth = dto.plannedMonth ?? null;
    }

    await this.opportunityRepository.update(id, patch);

    // Re-embed only when the embedded text or its scoping goal actually changed. A prd- or
    // owner-only edit must not spend an embedding call.
    const needsReindex = REINDEX_TRIGGERING_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== existing[field],
    );
    if (needsReindex) await this.vectorService.indexQuietly(id);

    const response = await this.findOne(userId, id);
    this.notifications.emit({
      kind: 'OPPORTUNITY_UPSERTED',
      actorId: userId,
      opportunity: response,
    });
    return response;
  }

  /**
   * `releasedAt` is stamped ONLY on the transition into RELEASED and never re-stamped.
   *
   * This lives in the service rather than a trigger for a concrete reason: split must COPY a
   * released parent's timestamp onto its new parts, not regenerate it, and a trigger would have
   * to be defeated to do that. Matches the source's `old.stage IS DISTINCT FROM 'released'`
   * condition, so released → prioritised → released does re-stamp.
   *
   * Note ~173 of 280 migrated released rows have a NULL releasedAt because the source trigger
   * also only fired on transition. Nothing here may backfill them.
   */
  private resolveReleasedAt(
    existing: RoadmapOpportunity,
    nextStage: RoadmapOpportunityStage,
  ): Date | null {
    const becomingReleased =
      nextStage === RoadmapOpportunityStage.RELEASED &&
      existing.stage !== RoadmapOpportunityStage.RELEASED;
    if (becomingReleased) return new Date();
    return existing.releasedAt ?? null;
  }

  /**
   * Soft delete. Hard-deletes the opportunity's allocations (via the FK's ON DELETE CASCADE
   * this would only fire on a hard delete, so it is done explicitly) so the coins are returned
   * to their owners' budgets and the priority score disappears, and removes the opportunity
   * from the vector index so duplicate-detection stops proposing it.
   */
  async remove(userId: number, id: string): Promise<void> {
    const existing = await this.opportunityRepository.findOne({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Opportunity ${id} not found`);

    await this.opportunityRepository.manager.transaction(async (manager) => {
      // Explicit: a soft delete does not trigger ON DELETE CASCADE, and leaving the rows would
      // keep other people's coins locked up in an invisible opportunity.
      await manager.query(
        `DELETE FROM roadmap_allocations WHERE "opportunityId" = $1`,
        [id],
      );
      await manager.softDelete(RoadmapOpportunity, id);
      await manager.query(
        `UPDATE roadmap_opportunity_comments SET "deletedAt" = now()
          WHERE "opportunityId" = $1 AND "deletedAt" IS NULL`,
        [id],
      );
    });

    await this.vectorService.removeQuietly(id);

    this.notifications.emit({
      kind: 'OPPORTUNITY_DELETED',
      actorId: userId,
      opportunityId: id,
    });
  }

  async getFacets(): Promise<RoadmapFacetsDto> {
    const { createdBy, goals, owners } =
      await this.opportunityRepository.getFacets();
    const users = await this.resolveUsers(createdBy);
    return {
      creators: createdBy.map((id) => users.get(id) ?? this.unknownUser(id)),
      goals,
      owners,
    };
  }

  /**
   * Attach creator identity, resolving Ally users in ONE query rather than per row.
   *
   * Public because the month board maps the same rows into the same shape — one opportunity must
   * not serialise differently depending on which layout asked for it.
   */
  async toResponseList(
    rows: RoadmapOpportunityRow[],
  ): Promise<OpportunityResponseDto[]> {
    const users = await this.resolveUsers(rows.map((r) => r.createdBy));
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      type: row.type,
      stage: row.stage,
      productGoal: row.productGoal,
      // The resolved display name, not the raw column — see RoadmapOpportunityRow.ownerDisplay.
      // `owner` stays the API's single owner field so no client has to know both representations.
      owner: row.ownerDisplay ?? row.owner ?? null,
      ownerUserId: row.ownerUserId ?? null,
      prd: row.prd ?? null,
      claudePrompt: row.claudePrompt ?? null,
      releasedAt: row.releasedAt ?? null,
      plannedMonth: row.plannedMonth ?? null,
      boardPosition: Number(row.boardPosition ?? 0),
      // Derived here rather than trusted from the row, so the single-opportunity read (which has
      // no lane context) reports the same month as the board.
      effectiveMonth: effectiveMonthOf(
        row.stage,
        row.releasedAt,
        row.plannedMonth,
      ),
      monthPinned: isMonthPinned(row.stage, row.releasedAt),
      priorityScore: Number(row.priorityScore ?? 0),
      myCoins: Number(row.myCoins ?? 0),
      commentCount: Number(row.commentCount ?? 0),
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      creator: users.get(row.createdBy) ?? this.unknownUser(row.createdBy),
    }));
  }

  /**
   * The users who may own an opportunity: Ally SUPER_ADMIN / SUPER_DUPER_ADMIN accounts.
   *
   * Group membership is the source of truth rather than a hand-maintained list, so somebody losing
   * super-admin stops appearing here without anyone remembering to prune a taxonomy table. Their
   * existing assignments are left alone — history should not silently rewrite itself.
   */
  async listEligibleOwners(): Promise<RoadmapEligibleOwnerDto[]> {
    const rows = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.name', 'user.email'])
      .where(
        `EXISTS (
           SELECT 1 FROM user_groups ug
           INNER JOIN groups g ON g.id = ug."groupId"
           WHERE ug."userId" = "user"."id" AND g.name IN (:...roles)
         )`,
        { roles: SUPER_ADMIN_ROLES },
      )
      .orderBy('user.name', 'ASC')
      .getMany();

    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  /**
   * Reject an owner who is not a super-admin.
   *
   * 422 rather than 400: the id is well-formed, it just names someone ineligible — the same shape
   * the coin-cap breach uses, so the client can show the message rather than a generic failure.
   */
  private async assertEligibleOwner(userId: number): Promise<void> {
    const eligible = await this.listEligibleOwners();
    if (!eligible.some((u) => u.id === userId)) {
      throw new UnprocessableEntityException(
        'An opportunity owner must be an Ally super-admin user.',
      );
    }
  }

  private async resolveUsers(
    ids: number[],
  ): Promise<Map<number, RoadmapUserRefDto>> {
    const unique = [
      ...new Set(ids.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (unique.length === 0) return new Map();

    const users = await this.userRepository.find({
      where: { id: In(unique) },
      select: ['id', 'email', 'name'],
    });
    return new Map(
      users.map((u) => [u.id, { id: u.id, email: u.email, name: u.name }]),
    );
  }

  /**
   * createdBy has no FK to users, so a removed Ally user leaves an unresolvable id. Return a
   * placeholder rather than leaking a bare integer into the UI.
   */
  private unknownUser(id: number): RoadmapUserRefDto {
    return { id, email: '', name: 'Unknown user' };
  }
}
