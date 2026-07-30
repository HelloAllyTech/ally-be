import { Injectable, NotFoundException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { User } from 'src/user/entity/user.entity';

import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import {
  RoadmapOpportunityRepository,
  RoadmapOpportunityRow,
} from '../repository/roadmap-opportunity.repository';
import {
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
  UpdateOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  GetOpportunitiesResponseDto,
  OpportunityResponseDto,
  RoadmapFacetsDto,
  RoadmapUserRefDto,
} from '../dto/roadmap-response.dto';
import { currentPeriodKey } from '../util/roadmap-period.util';
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

  async create(
    userId: number,
    dto: CreateOpportunityDto,
  ): Promise<OpportunityResponseDto> {
    const saved = await this.opportunityRepository.save(
      this.opportunityRepository.create({
        description: dto.description.trim(),
        type: dto.type,
        productGoal: dto.productGoal,
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    // Best-effort and awaited: the row is already committed, so a vector failure cannot roll
    // it back, but awaiting means the very next duplicate check sees this opportunity.
    await this.vectorService.indexQuietly(saved.id);

    const response = await this.findOne(userId, saved.id);
    this.notifications.emit({
      kind: 'OPPORTUNITY_UPSERTED',
      actorId: userId,
      opportunity: response,
    });
    return response;
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
    if (dto.owner !== undefined) patch.owner = dto.owner ?? null;
    if (dto.prd !== undefined) patch.prd = dto.prd ?? null;

    if (dto.stage !== undefined) {
      patch.stage = dto.stage;
      patch.releasedAt = this.resolveReleasedAt(existing, dto.stage);
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

  /** Attach creator identity, resolving Ally users in ONE query rather than per row. */
  private async toResponseList(
    rows: RoadmapOpportunityRow[],
  ): Promise<OpportunityResponseDto[]> {
    const users = await this.resolveUsers(rows.map((r) => r.createdBy));
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      type: row.type,
      stage: row.stage,
      productGoal: row.productGoal,
      owner: row.owner ?? null,
      prd: row.prd ?? null,
      releasedAt: row.releasedAt ?? null,
      priorityScore: Number(row.priorityScore ?? 0),
      myCoins: Number(row.myCoins ?? 0),
      commentCount: Number(row.commentCount ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      creator: users.get(row.createdBy) ?? this.unknownUser(row.createdBy),
    }));
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
