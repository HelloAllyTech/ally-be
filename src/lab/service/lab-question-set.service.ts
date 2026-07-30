import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import {
  LabQuestionSetRepository,
  LabQuestionSetQuestionRepository,
} from '../repository/lab-question-set.repository';
import { LabQuestionSet } from '../entity/lab-question-set.entity';
import { LabQuestionSetQuestion } from '../entity/lab-question-set-question.entity';
import { LabEvalQuestionType } from '../entity/lab-eval-question.entity';
import {
  ArchiveQuestionSetDto,
  CreateQuestionSetDto,
  ListQuestionSetsQueryDto,
  UpdateQuestionSetDto,
} from '../dto/lab-question-set.dto';
import { EvalQuestionDto } from '../dto/lab-eval.dto';

const questionResponse = (q: LabQuestionSetQuestion) => ({
  id: q.id,
  question: q.question,
  type: q.type,
  scaleMin: q.scaleMin,
  scaleMax: q.scaleMax,
  position: q.position,
});

const toResponse = (
  set: LabQuestionSet,
  questions: LabQuestionSetQuestion[],
) => ({
  id: set.id,
  name: set.name,
  description: set.description ?? null,
  publishedAt: set.publishedAt ?? null,
  archivedAt: set.archivedAt ?? null,
  isPublished: set.publishedAt != null,
  isArchived: set.archivedAt != null,
  createdBy: set.createdBy,
  createdAt: set.createdAt,
  updatedAt: set.updatedAt,
  questionCount: questions.length,
  questions: questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(questionResponse),
});

const buildQuestionRows = (
  setId: string,
  questions: EvalQuestionDto[],
): Partial<LabQuestionSetQuestion>[] =>
  questions.map((q, index) => ({
    questionSetId: setId,
    question: q.question.trim(),
    type: q.type,
    scaleMin: 1,
    scaleMax: q.type === LabEvalQuestionType.RATING ? (q.scaleMax ?? 5) : 5,
    position: index,
  }));

@Injectable()
export class LabQuestionSetService {
  private readonly logger = LoggerService.getInstance(
    LabQuestionSetService.name,
  );

  constructor(
    private readonly setRepository: LabQuestionSetRepository,
    private readonly questionRepository: LabQuestionSetQuestionRepository,
    private readonly dataSource: DataSource,
  ) {}

  private async getEntity(id: string): Promise<LabQuestionSet> {
    const set = await this.setRepository.findOne({ where: { id } });
    if (!set) {
      throw new NotFoundException(`Question set with ID ${id} not found`);
    }
    return set;
  }

  private async getQuestions(setId: string): Promise<LabQuestionSetQuestion[]> {
    return this.questionRepository.find({
      where: { questionSetId: setId },
      order: { position: 'ASC' },
    });
  }

  async list(query: ListQuestionSetsQueryDto) {
    const { items, count } = await this.setRepository.list({
      search: query.search,
      includeArchived: query.includeArchived,
      publishedOnly: query.publishedOnly,
      limit: query.limit,
      offset: query.offset,
    });

    const setIds = items.map((s) => s.id);
    const questionCounts = new Map<string, number>();
    if (setIds.length > 0) {
      const rows: { question_set_id: string; count: string }[] =
        await this.questionRepository
          .createQueryBuilder('question')
          .select('question.questionSetId', 'question_set_id')
          .addSelect('COUNT(*)', 'count')
          .where('question.questionSetId IN (:...setIds)', { setIds })
          .groupBy('question.questionSetId')
          .getRawMany();
      for (const row of rows) {
        questionCounts.set(row.question_set_id, Number(row.count));
      }
    }

    return {
      items: items.map((set) => ({
        id: set.id,
        name: set.name,
        description: set.description ?? null,
        publishedAt: set.publishedAt ?? null,
        archivedAt: set.archivedAt ?? null,
        isPublished: set.publishedAt != null,
        isArchived: set.archivedAt != null,
        createdBy: set.createdBy,
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
        questionCount: questionCounts.get(set.id) ?? 0,
      })),
      count,
    };
  }

  async getById(id: string) {
    const set = await this.getEntity(id);
    const questions = await this.getQuestions(id);
    return toResponse(set, questions);
  }

  async create(dto: CreateQuestionSetDto) {
    const userId = Number(ExecutionManager.getUserId() ?? 0);

    const { set, questions } = await this.dataSource.transaction(
      async (manager) => {
        const created = await manager.save(
          manager.create(LabQuestionSet, {
            name: dto.name.trim(),
            description: dto.description ?? null,
            createdBy: userId,
          }),
        );
        const questionRows = dto.questions?.length
          ? await manager.save(
              buildQuestionRows(created.id, dto.questions).map((row) =>
                manager.create(LabQuestionSetQuestion, row),
              ),
            )
          : [];
        return { set: created, questions: questionRows };
      },
    );

    this.logger.info(
      `[AI_LAB] question set created: ${set.id} (${questions.length} questions)`,
    );
    return toResponse(set, questions);
  }

  /** Draft-only: rejects any edit once the set is published (frozen). */
  async update(id: string, dto: UpdateQuestionSetDto) {
    const set = await this.getEntity(id);
    if (set.publishedAt) {
      throw new BadRequestException(
        'A published question set cannot be edited',
      );
    }

    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.description !== undefined) set.description = dto.description;

    const { saved, questions } = await this.dataSource.transaction(
      async (manager) => {
        const savedSet = await manager.save(set);
        let currentQuestions: LabQuestionSetQuestion[];
        if (dto.questions !== undefined) {
          await manager.delete(LabQuestionSetQuestion, { questionSetId: id });
          currentQuestions = dto.questions.length
            ? await manager.save(
                buildQuestionRows(id, dto.questions).map((row) =>
                  manager.create(LabQuestionSetQuestion, row),
                ),
              )
            : [];
        } else {
          currentQuestions = await manager.find(LabQuestionSetQuestion, {
            where: { questionSetId: id },
            order: { position: 'ASC' },
          });
        }
        return { saved: savedSet, questions: currentQuestions };
      },
    );

    this.logger.info(`[AI_LAB] question set updated: ${id}`);
    return toResponse(saved, questions);
  }

  /** Publish (lock) the set. Requires at least one question. One-way. */
  async publish(id: string) {
    const set = await this.getEntity(id);
    if (set.publishedAt) {
      throw new ConflictException('Question set is already published');
    }
    const questions = await this.getQuestions(id);
    if (questions.length === 0) {
      throw new BadRequestException(
        'Add at least one question before publishing',
      );
    }

    const claim = await this.setRepository
      .createQueryBuilder()
      .update(LabQuestionSet)
      .set({ publishedAt: () => 'now()' })
      .where('id = :id AND published_at IS NULL', { id })
      .execute();
    if (!claim.affected) {
      throw new ConflictException('Question set is already published');
    }

    set.publishedAt = new Date();
    this.logger.info(`[AI_LAB] question set published: ${id}`);
    return toResponse(set, questions);
  }

  /** Archive/unarchive — published sets only; reversible, hides from picker. */
  async archive(id: string, dto: ArchiveQuestionSetDto) {
    const set = await this.getEntity(id);
    if (!set.publishedAt) {
      throw new BadRequestException(
        'Only a published question set can be archived',
      );
    }
    set.archivedAt = dto.isArchived ? new Date() : null;
    const saved = await this.setRepository.save(set);
    const questions = await this.getQuestions(id);
    this.logger.info(
      `[AI_LAB] question set ${id} archived=${saved.archivedAt != null}`,
    );
    return toResponse(saved, questions);
  }

  /** Hard delete — draft (never-published) sets only. */
  async remove(id: string): Promise<{ success: boolean }> {
    const set = await this.getEntity(id);
    if (set.publishedAt) {
      throw new BadRequestException(
        'A published question set cannot be deleted — archive it instead',
      );
    }
    await this.setRepository.delete(id);
    this.logger.info(`[AI_LAB] question set deleted: ${id}`);
    return { success: true };
  }
}
