import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { TrackComponentTemplate } from '../entity/track-component-template.entity';
import { TrackComponentTemplateRepository } from '../repository/track-component-template.repository';
import { TrackItemType } from '../type/track.type';
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
}
