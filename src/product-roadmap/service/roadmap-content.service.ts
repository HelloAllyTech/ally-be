import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapInterviewNote } from '../entity/roadmap-interview-note.entity';
import { RoadmapInterviewNoteRepository } from '../repository/roadmap-content.repository';
import {
  CreateInterviewNoteDto,
  RoadmapListQueryDto,
  UpdateInterviewNoteDto,
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
