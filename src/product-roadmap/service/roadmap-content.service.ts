import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapInterviewNote } from '../entity/roadmap-interview-note.entity';
import { RoadmapReleaseNote } from '../entity/roadmap-release-note.entity';
import {
  RoadmapInterviewNoteRepository,
  RoadmapReleaseNoteRepository,
} from '../repository/roadmap-content.repository';
import {
  CreateInterviewNoteDto,
  CreateReleaseNoteDto,
  RoadmapListQueryDto,
  UpdateInterviewNoteDto,
  UpdateReleaseNoteDto,
} from '../dto/roadmap-content.dto';
import { ROADMAP_LIST_DEFAULTS } from '../constants/product-roadmap.constants';
import { RoadmapNotificationService } from './roadmap-notification.service';

@Injectable()
export class RoadmapInterviewNoteService {
  constructor(
    private readonly repository: RoadmapInterviewNoteRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  async list(query: RoadmapListQueryDto) {
    const [items, count] = await this.repository.search(
      query.search,
      Math.min(
        query.limit ?? ROADMAP_LIST_DEFAULTS.LIMIT,
        ROADMAP_LIST_DEFAULTS.MAX_LIMIT,
      ),
      query.offset ?? 0,
    );
    return { items, count };
  }

  async create(
    userId: number,
    dto: CreateInterviewNoteDto,
  ): Promise<RoadmapInterviewNote> {
    const saved = await this.repository.save(
      this.repository.create({
        title: dto.title.trim(),
        interviewee: dto.interviewee?.trim() || null,
        transcript: dto.transcript ?? null,
        summary: dto.summary.trim(),
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    this.invalidate(userId);
    return saved;
  }

  /**
   * Edit a note. The author OR a manager may edit — unlike comments, a research note is a
   * shared artefact rather than someone's speech, so managers can correct it.
   */
  async update(
    userId: number,
    id: string,
    dto: UpdateInterviewNoteDto,
    canManage: boolean,
  ): Promise<RoadmapInterviewNote> {
    const note = await this.require(id);
    this.assertCanMutate(note, userId, canManage);

    if (dto.title !== undefined) note.title = dto.title.trim();
    if (dto.interviewee !== undefined)
      note.interviewee = dto.interviewee?.trim() || null;
    if (dto.transcript !== undefined) note.transcript = dto.transcript ?? null;
    if (dto.summary !== undefined) note.summary = dto.summary.trim();
    note.updatedBy = userId;

    const saved = await this.repository.save(note);
    this.invalidate(userId);
    return saved;
  }

  async remove(userId: number, id: string, canManage: boolean): Promise<void> {
    const note = await this.require(id);
    this.assertCanMutate(note, userId, canManage);
    await this.repository.softDelete(id);
    this.invalidate(userId);
  }

  private async require(id: string): Promise<RoadmapInterviewNote> {
    const note = await this.repository.findOne({ where: { id } });
    if (!note) throw new NotFoundException(`Interview note ${id} not found`);
    return note;
  }

  private assertCanMutate(
    note: RoadmapInterviewNote,
    userId: number,
    canManage: boolean,
  ): void {
    if (note.createdBy !== userId && !canManage) {
      throw new ForbiddenException(
        'Only the author or a roadmap manager can change this interview note',
      );
    }
  }

  private invalidate(userId: number): void {
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'interviews',
    });
  }
}

/**
 * Release notes.
 *
 * READ is gated on view:admin:product-roadmap, WRITE on edit:. That read gate is a deliberate
 * divergence from a literal RLS port: the source's policy was admin-only for SELECT too, but
 * because RLS filters rows rather than rejecting requests, a non-admin got `200 []` and the
 * client relied on that. Gating reads on edit: would answer 403 where the client expects an
 * empty list — and release notes are the most shareable artefact here, so opening reads is
 * probably what the team wants anyway.
 */
@Injectable()
export class RoadmapReleaseNoteService {
  constructor(
    private readonly repository: RoadmapReleaseNoteRepository,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  async list(query: RoadmapListQueryDto) {
    const [items, count] = await this.repository.findAllNewestFirst(
      Math.min(
        query.limit ?? ROADMAP_LIST_DEFAULTS.LIMIT,
        ROADMAP_LIST_DEFAULTS.MAX_LIMIT,
      ),
      query.offset ?? 0,
    );
    return { items, count };
  }

  async create(
    userId: number,
    dto: CreateReleaseNoteDto,
  ): Promise<RoadmapReleaseNote> {
    const saved = await this.repository.save(
      this.repository.create({
        title: dto.title?.trim() || null,
        content: dto.content.trim(),
        // Stored verbatim as a snapshot. Not validated against live opportunities: the whole
        // point is that the note keeps rendering after the board moves on.
        opportunityIds: dto.opportunityIds,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    this.invalidate(userId);
    return saved;
  }

  async update(
    userId: number,
    id: string,
    dto: UpdateReleaseNoteDto,
  ): Promise<RoadmapReleaseNote> {
    const note = await this.require(id);
    if (dto.title !== undefined) note.title = dto.title?.trim() || null;
    if (dto.content !== undefined) note.content = dto.content.trim();
    if (dto.opportunityIds !== undefined)
      note.opportunityIds = dto.opportunityIds;
    note.updatedBy = userId;

    const saved = await this.repository.save(note);
    this.invalidate(userId);
    return saved;
  }

  async remove(userId: number, id: string): Promise<void> {
    await this.require(id);
    await this.repository.softDelete(id);
    this.invalidate(userId);
  }

  private async require(id: string): Promise<RoadmapReleaseNote> {
    const note = await this.repository.findOne({ where: { id } });
    if (!note) throw new NotFoundException(`Release note ${id} not found`);
    return note;
  }

  private invalidate(userId: number): void {
    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: userId,
      reason: 'releaseNotes',
    });
  }
}
