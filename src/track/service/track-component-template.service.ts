import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { In } from 'typeorm';
import {
  htmlToPlainText,
  sanitizeDescriptionHtml,
} from 'src/common/util/sanitize-html.util';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { TrackComponentTemplate } from '../entity/track-component-template.entity';
import { TrackComponentTemplateRepository } from '../repository/track-component-template.repository';
import { TrackItemType } from '../type/track.type';
import {
  ArticleContent,
  JournalContent,
  VideoContent,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';
import {
  CreateTrackComponentTemplateDto,
  SUPPORTED_TRACK_COMPONENT_TEMPLATE_TYPES,
  UpdateTrackComponentTemplateDto,
} from '../dto/track-component-template.dto';
import { validateTrackItemContent } from './track-structure.validator';

export interface TrackComponentTemplateListParams {
  type?: TrackItemType;
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class TrackComponentTemplateService {
  private readonly logger = LoggerService.getInstance(
    TrackComponentTemplateService.name,
  );

  constructor(
    private readonly templateRepository: TrackComponentTemplateRepository,
  ) {}

  async list(
    params: TrackComponentTemplateListParams = {},
  ): Promise<{ items: TrackComponentTemplate[]; total: number }> {
    const { type, search, limit = 20, offset = 0 } = params;

    return this.templateRepository.listTemplates({
      type,
      search,
      limit: Number(limit),
      offset: Number(offset),
    });
  }

  async getById(id: string): Promise<TrackComponentTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });

    if (!template) {
      throw new NotFoundException(`Component template with ID ${id} not found`);
    }

    return template;
  }

  async create(
    dto: CreateTrackComponentTemplateDto,
  ): Promise<TrackComponentTemplate> {
    this.assertSupportedType(dto.type);

    this.applyContentDerivations(dto.type, dto.content);

    validateTrackItemContent({
      type: dto.type,
      content: dto.content,
      title: dto.title,
    });

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    const template = this.templateRepository.create({
      type: dto.type,
      title: dto.title,
      content: dto.content,
      completionCriteria: dto.completionCriteria,
      createdBy: Number(userId),
      updatedBy: Number(userId),
    });

    const saved = await this.templateRepository.save(template);
    this.logger.info(`Component template created: ${saved.id}`);
    return saved;
  }

  async update(
    id: string,
    dto: UpdateTrackComponentTemplateDto,
  ): Promise<TrackComponentTemplate> {
    // Re-read first so a missing id 404s before anything is written.
    const existing = await this.getById(id);

    if (dto.content !== undefined) {
      this.applyContentDerivations(existing.type, dto.content);
      validateTrackItemContent({
        type: existing.type,
        content: dto.content,
        title: dto.title ?? existing.title,
      });
    }

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException();
    }

    await this.templateRepository.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.completionCriteria !== undefined
        ? { completionCriteria: dto.completionCriteria }
        : {}),
      updatedBy: Number(userId),
    });

    const template = await this.getById(id);
    this.logger.info(`Component template updated: ${id}`);
    return template;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    await this.templateRepository.delete(id);
    this.logger.info(`Component template deleted: ${id}`);
    return { success: true };
  }

  async bulkDelete(ids: string[]): Promise<{ success: boolean }> {
    if (ids.length === 0) {
      throw new BadRequestException(
        'At least one component template ID is required',
      );
    }

    const result = await this.templateRepository.delete({ id: In(ids) });
    this.logger.info(
      `Component templates deleted: ${result.affected ?? 0} of ${ids.length} requested`,
    );
    return { success: (result.affected ?? 0) > 0 };
  }

  private assertSupportedType(type: TrackItemType): void {
    if (!SUPPORTED_TRACK_COMPONENT_TEMPLATE_TYPES.includes(type)) {
      throw new BadRequestException(
        `Component templates do not support type ${type}. Supported types: ${SUPPORTED_TRACK_COMPONENT_TEMPLATE_TYPES.join(', ')}.`,
      );
    }
  }

  private applyContentDerivations(type: TrackItemType, content: any): void {
    if (!content) return;

    if (type === TrackItemType.QUIZ) {
      const quiz = content as QuizContent;
      for (const question of quiz.questions ?? []) {
        if (typeof question.promptHtml === 'string') {
          question.promptHtml = sanitizeDescriptionHtml(question.promptHtml);
          question.prompt = htmlToPlainText(question.promptHtml);
        } else if (
          question.promptHtml !== undefined &&
          question.promptHtml !== null
        ) {
          throw new BadRequestException('promptHtml must be a string');
        }
      }
    } else if (type === TrackItemType.ARTICLE) {
      const article = content as ArticleContent;
      for (const question of article.questions ?? []) {
        if (typeof question.promptHtml === 'string') {
          question.promptHtml = sanitizeDescriptionHtml(question.promptHtml);
          question.prompt = htmlToPlainText(question.promptHtml);
        } else if (
          question.promptHtml !== undefined &&
          question.promptHtml !== null
        ) {
          throw new BadRequestException('promptHtml must be a string');
        }
      }
    } else if (type === TrackItemType.VIDEO) {
      const video = content as VideoContent;
      for (const interjection of video.interjections ?? []) {
        if (typeof interjection.question.promptHtml === 'string') {
          interjection.question.promptHtml = sanitizeDescriptionHtml(
            interjection.question.promptHtml,
          );
          interjection.question.prompt = htmlToPlainText(
            interjection.question.promptHtml,
          );
        } else if (
          interjection.question.promptHtml !== undefined &&
          interjection.question.promptHtml !== null
        ) {
          throw new BadRequestException('promptHtml must be a string');
        }
      }
    } else if (type === TrackItemType.JOURNAL) {
      const journal = content as JournalContent;
      for (const prompt of journal.prompts ?? []) {
        if (typeof prompt.promptHtml === 'string') {
          prompt.promptHtml = sanitizeDescriptionHtml(prompt.promptHtml);
          prompt.prompt = htmlToPlainText(prompt.promptHtml);
        } else if (
          prompt.promptHtml !== undefined &&
          prompt.promptHtml !== null
        ) {
          throw new BadRequestException('promptHtml must be a string');
        }
      }
    }
  }
}
