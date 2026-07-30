import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapOpportunityComment } from '../entity/roadmap-opportunity-comment.entity';
import { RoadmapOpportunityCommentRepository } from '../repository/roadmap-content.repository';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { CreateCommentDto, UpdateCommentDto } from '../dto/roadmap-content.dto';
import { RoadmapNotificationService } from './roadmap-notification.service';

@Injectable()
export class RoadmapCommentService {
  constructor(
    private readonly commentRepository: RoadmapOpportunityCommentRepository,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  async list(opportunityId: string): Promise<RoadmapOpportunityComment[]> {
    return this.commentRepository.findForOpportunity(opportunityId);
  }

  async create(
    userId: number,
    opportunityId: string,
    dto: CreateCommentDto,
  ): Promise<RoadmapOpportunityComment> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    const saved = await this.commentRepository.save(
      this.commentRepository.create({
        opportunityId,
        body: dto.body.trim(),
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    this.notifications.emit({
      kind: 'COMMENT_CHANGED',
      actorId: userId,
      opportunityId,
      action: 'created',
      commentId: saved.id,
    });
    return saved;
  }

  /**
   * Edit a comment. ONLY THE AUTHOR MAY EDIT — a manager holding
   * edit:admin:product-roadmap may not rewrite someone else's words.
   *
   * This asymmetry against delete (below) is deliberate and ported from the source's RLS
   * policies. It is not an oversight and should not be "simplified" into a single permission
   * check; there is a test asserting a non-author with edit: gets a 403 here.
   */
  async update(
    userId: number,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<RoadmapOpportunityComment> {
    const comment = await this.requireComment(commentId);
    if (comment.createdBy !== userId) {
      throw new ForbiddenException('Only the author can edit a comment');
    }

    comment.body = dto.body.trim();
    comment.updatedBy = userId;
    const saved = await this.commentRepository.save(comment);

    this.notifications.emit({
      kind: 'COMMENT_CHANGED',
      actorId: userId,
      opportunityId: comment.opportunityId,
      action: 'updated',
      commentId: saved.id,
    });
    return saved;
  }

  /**
   * Delete a comment. The AUTHOR **or** a manager may delete — moderation is a legitimate
   * manager capability even though rewriting is not.
   */
  async remove(
    userId: number,
    commentId: string,
    canManage: boolean,
  ): Promise<void> {
    const comment = await this.requireComment(commentId);
    if (comment.createdBy !== userId && !canManage) {
      throw new ForbiddenException(
        'Only the author or a roadmap manager can delete a comment',
      );
    }

    await this.commentRepository.softDelete(commentId);
    this.notifications.emit({
      kind: 'COMMENT_CHANGED',
      actorId: userId,
      opportunityId: comment.opportunityId,
      action: 'deleted',
      commentId,
    });
  }

  private async requireComment(id: string): Promise<RoadmapOpportunityComment> {
    const comment = await this.commentRepository.findOne({ where: { id } });
    if (!comment) throw new NotFoundException(`Comment ${id} not found`);
    return comment;
  }
}
