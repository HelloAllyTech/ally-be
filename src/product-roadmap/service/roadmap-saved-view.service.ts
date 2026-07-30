import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapSavedView } from '../entity/roadmap-saved-view.entity';
import { RoadmapSavedViewRepository } from '../repository/roadmap-saved-view.repository';
import { RoadmapUserTabOrderRepository } from '../repository/roadmap-content.repository';
import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from '../dto/roadmap-content.dto';
import { RoadmapNotificationService } from './roadmap-notification.service';

@Injectable()
export class RoadmapSavedViewService {
  constructor(
    private readonly savedViewRepository: RoadmapSavedViewRepository,
    private readonly tabOrderRepository: RoadmapUserTabOrderRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /** Own views plus every pinned view. The row filter lives in the repository — see its docblock. */
  async list(userId: number): Promise<RoadmapSavedView[]> {
    return this.savedViewRepository.findVisibleTo(userId);
  }

  async create(
    userId: number,
    dto: CreateSavedViewDto,
  ): Promise<RoadmapSavedView> {
    return this.savedViewRepository.save(
      this.savedViewRepository.create({
        name: dto.name.trim(),
        state: dto.state,
        // Never from the DTO: pinning is its own endpoint, gated on edit:.
        pinned: false,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /**
   * Rename or re-snapshot a view. Owner-only (or a manager), and `pinned` is rejected outright
   * even though the DTO omits it — a client could still send it, and class-validator's default
   * whitelist behaviour is not enabled globally here.
   */
  async update(
    userId: number,
    id: string,
    dto: UpdateSavedViewDto & { pinned?: unknown },
    canManage: boolean,
  ): Promise<RoadmapSavedView> {
    if (dto.pinned !== undefined) {
      throw new BadRequestException(
        'Use PUT /views/:id/pin to change pinning; it requires roadmap manage permission',
      );
    }

    const view = await this.requireView(id);
    this.assertCanMutate(view, userId, canManage);

    if (dto.name !== undefined) view.name = dto.name.trim();
    if (dto.state !== undefined) view.state = dto.state;
    view.updatedBy = userId;

    return this.savedViewRepository.save(view);
  }

  /**
   * Pin or unpin a view for everyone. Gated on edit:admin:product-roadmap at the controller —
   * that decorator is the whole enforcement, and it replaces the source's enforce_pin_admin()
   * trigger, which only existed because RLS let a creator update their own row's `pinned`.
   */
  async setPinned(
    userId: number,
    id: string,
    pinned: boolean,
  ): Promise<RoadmapSavedView> {
    const view = await this.requireView(id);
    view.pinned = pinned;
    view.updatedBy = userId;
    const saved = await this.savedViewRepository.save(view);

    // Everyone's tab strip changes, so this is a board-wide invalidation.
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'views',
    });
    return saved;
  }

  async remove(userId: number, id: string, canManage: boolean): Promise<void> {
    const view = await this.requireView(id);
    this.assertCanMutate(view, userId, canManage);
    await this.savedViewRepository.softDelete(id);

    if (view.pinned) {
      this.notifications.emit({
        kind: 'ROADMAP_INVALIDATED',
        actorId: userId,
        reason: 'views',
      });
    }
  }

  async getTabOrder(userId: number): Promise<{ viewIds: string[] }> {
    const row = await this.tabOrderRepository.findOne({ where: { userId } });
    return { viewIds: row?.viewIds ?? [] };
  }

  async setTabOrder(
    userId: number,
    viewIds: string[],
  ): Promise<{ viewIds: string[] }> {
    await this.tabOrderRepository.setOrder(userId, viewIds);
    return { viewIds };
  }

  private async requireView(id: string): Promise<RoadmapSavedView> {
    const view = await this.savedViewRepository.findOne({ where: { id } });
    if (!view) throw new NotFoundException(`Saved view ${id} not found`);
    return view;
  }

  private assertCanMutate(
    view: RoadmapSavedView,
    userId: number,
    canManage: boolean,
  ): void {
    if (view.createdBy !== userId && !canManage) {
      throw new ForbiddenException(
        'Only the view owner or a roadmap manager can change this view',
      );
    }
  }
}
