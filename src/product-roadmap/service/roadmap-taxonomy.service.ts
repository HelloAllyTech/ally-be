import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapProductGoal } from '../entity/roadmap-product-goal.entity';
import { RoadmapOpportunityOwner } from '../entity/roadmap-opportunity-owner.entity';
import {
  RoadmapOpportunityOwnerRepository,
  RoadmapProductGoalRepository,
} from '../repository/roadmap-taxonomy.repository';
import { RoadmapNotificationService } from './roadmap-notification.service';

@Injectable()
export class RoadmapTaxonomyService {
  constructor(
    private readonly goalRepository: RoadmapProductGoalRepository,
    private readonly ownerRepository: RoadmapOpportunityOwnerRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  // ── product goals ──────────────────────────────────────────────────────────

  listGoals(): Promise<RoadmapProductGoal[]> {
    return this.goalRepository.findAllOrdered();
  }

  async createGoal(userId: number, name: string): Promise<RoadmapProductGoal> {
    const trimmed = name.trim();
    if (await this.goalRepository.findOne({ where: { name: trimmed } })) {
      throw new ConflictException(
        `A product goal named "${trimmed}" already exists`,
      );
    }
    const position = await this.goalRepository.count();
    const saved = await this.goalRepository.save(
      this.goalRepository.create({ name: trimmed, position }),
    );
    this.invalidate(userId, 'goals');
    return saved;
  }

  /**
   * Rename. The FK on roadmap_opportunities.productGoal is ON UPDATE CASCADE, so every
   * opportunity follows automatically — and so do the goal names stored inside saved-view
   * state, which is exactly why the FK is by name rather than by uuid.
   *
   * The cascade touches an unbounded number of rows this service never sees, which is why the
   * broadcast is a board-wide invalidation rather than a per-row delta.
   */
  async renameGoal(
    userId: number,
    id: string,
    nextName: string,
  ): Promise<RoadmapProductGoal> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Product goal ${id} not found`);
    const currentName = goal.name;

    const trimmed = nextName.trim();
    if (
      trimmed !== currentName &&
      (await this.goalRepository.findOne({ where: { name: trimmed } }))
    ) {
      throw new ConflictException(
        `A product goal named "${trimmed}" already exists`,
      );
    }

    goal.name = trimmed;
    const saved = await this.goalRepository.save(goal);
    this.invalidate(userId, 'goals');
    return saved;
  }

  /**
   * Delete. The FK is ON DELETE RESTRICT, so this would fail at the database level with a 500;
   * check usage first and answer 409 with the count instead.
   */
  async deleteGoal(userId: number, id: string): Promise<void> {
    const goal = await this.goalRepository.findOne({ where: { id } });
    if (!goal) throw new NotFoundException(`Product goal ${id} not found`);
    const name = goal.name;

    const usage = await this.goalRepository.countUsage(name);
    if (usage > 0) {
      throw new ConflictException(
        `"${name}" is still assigned to ${usage} opportunit${usage === 1 ? 'y' : 'ies'}. ` +
          `Reassign them before deleting the goal.`,
      );
    }

    await this.goalRepository.remove(goal);
    this.invalidate(userId, 'goals');
  }

  async reorderGoals(userId: number, ids: string[]): Promise<void> {
    await this.applyOrder(ids, (id, position) =>
      this.goalRepository.update({ id }, { position }),
    );
    this.invalidate(userId, 'goals');
  }

  // ── owners ─────────────────────────────────────────────────────────────────

  listOwners(): Promise<RoadmapOpportunityOwner[]> {
    return this.ownerRepository.findAllOrdered();
  }

  async createOwner(
    userId: number,
    name: string,
  ): Promise<RoadmapOpportunityOwner> {
    const trimmed = name.trim();
    if (await this.ownerRepository.findOne({ where: { name: trimmed } })) {
      throw new ConflictException(`An owner named "${trimmed}" already exists`);
    }
    const position = await this.ownerRepository.count();
    const saved = await this.ownerRepository.save(
      this.ownerRepository.create({ name: trimmed, position }),
    );
    this.invalidate(userId, 'owners');
    return saved;
  }

  async renameOwner(
    userId: number,
    id: string,
    nextName: string,
  ): Promise<RoadmapOpportunityOwner> {
    const owner = await this.ownerRepository.findOne({ where: { id } });
    if (!owner) throw new NotFoundException(`Owner ${id} not found`);
    const currentName = owner.name;

    const trimmed = nextName.trim();
    if (
      trimmed !== currentName &&
      (await this.ownerRepository.findOne({ where: { name: trimmed } }))
    ) {
      throw new ConflictException(`An owner named "${trimmed}" already exists`);
    }

    owner.name = trimmed;
    const saved = await this.ownerRepository.save(owner);
    this.invalidate(userId, 'owners');
    return saved;
  }

  /**
   * Delete an owner. Unlike goals this does NOT block: the FK is ON DELETE SET NULL, so the
   * affected opportunities are simply un-assigned. Callers should surface the count as a
   * warning first (GET /opportunity-owners returns it).
   */
  async deleteOwner(
    userId: number,
    id: string,
  ): Promise<{ unassigned: number }> {
    const owner = await this.ownerRepository.findOne({ where: { id } });
    if (!owner) throw new NotFoundException(`Owner ${id} not found`);
    const name = owner.name;

    const unassigned = await this.ownerRepository.countUsage(name);
    await this.ownerRepository.remove(owner);
    this.invalidate(userId, 'owners');
    return { unassigned };
  }

  async reorderOwners(userId: number, ids: string[]): Promise<void> {
    await this.applyOrder(ids, (id, position) =>
      this.ownerRepository.update({ id }, { position }),
    );
    this.invalidate(userId, 'owners');
  }

  /** Usage counts for the settings UI, so an admin sees the cost of a delete before clicking. */
  async getOwnerUsage(): Promise<Record<string, number>> {
    const owners = await this.ownerRepository.findAllOrdered();
    const entries = await Promise.all(
      owners.map(
        async (o) =>
          [o.name, await this.ownerRepository.countUsage(o.name)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  async getGoalUsage(): Promise<Record<string, number>> {
    const goals = await this.goalRepository.findAllOrdered();
    const entries = await Promise.all(
      goals.map(
        async (g) =>
          [g.name, await this.goalRepository.countUsage(g.name)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  private async applyOrder(
    ids: string[],
    update: (id: string, position: number) => Promise<unknown>,
  ): Promise<void> {
    for (const [position, id] of ids.entries()) {
      await update(id, position);
    }
  }

  private invalidate(userId: number, reason: 'goals' | 'owners'): void {
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason,
    });
  }
}
