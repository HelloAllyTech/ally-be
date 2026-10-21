import { BadRequestException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { NotFoundException } from 'src/exception/custom.exception';

import {
  CreatePublicRoadmapItemDto,
  GetPublicRoadmapResponseDto,
  PublicRoadmapCardDto,
  PublicRoadmapItemDto,
  UpdatePublicRoadmapItemDto,
} from '../dto/public-roadmap-item.dto';
import { PublicRoadmapItem } from '../entity/public-roadmap-item.entity';
import { PublicRoadmapItemRepository } from '../repository/public-roadmap-item.repository';

/**
 * The public product roadmap: hand-written cards on a categories × stages
 * grid. Reads are public; every write goes live on save (there is no draft
 * state — `isPublic` is how a card is kept off the page).
 */
@Injectable()
export class PublicRoadmapService {
  constructor(private readonly repository: PublicRoadmapItemRepository) {}

  async getPublicRoadmap(): Promise<GetPublicRoadmapResponseDto> {
    const items = await this.repository.listOrdered({ publicOnly: true });
    return {
      items: items.map(toCard),
      updatedAt: latestUpdate(items),
    };
  }

  async listAll(): Promise<PublicRoadmapItemDto[]> {
    const items = await this.repository.listOrdered({ publicOnly: false });
    return items.map(toAdminItem);
  }

  async create(dto: CreatePublicRoadmapItemDto): Promise<PublicRoadmapItemDto> {
    const userId = currentUserId();
    const item = this.repository.create({
      title: requiredText(dto.title, 'title'),
      description: requiredText(dto.description, 'description'),
      note: optionalText(dto.note),
      category: dto.category,
      stage: dto.stage,
      isPublic: dto.isPublic ?? true,
      sortOrder: await this.repository.nextSortOrder(dto.category, dto.stage),
      createdBy: userId,
      updatedBy: userId,
    });
    return toAdminItem(await this.repository.save(item));
  }

  async update(
    id: string,
    dto: UpdatePublicRoadmapItemDto,
  ): Promise<PublicRoadmapItemDto> {
    const item = await this.findOrThrow(id);

    if (dto.title !== undefined) item.title = requiredText(dto.title, 'title');
    if (dto.description !== undefined) {
      item.description = requiredText(dto.description, 'description');
    }
    if (dto.note !== undefined) item.note = optionalText(dto.note);
    if (dto.isPublic !== undefined) item.isPublic = dto.isPublic;

    const category = dto.category ?? item.category;
    const stage = dto.stage ?? item.stage;
    if (category !== item.category || stage !== item.stage) {
      // A card moved to another cell joins the end of it, rather than keeping
      // a position number that meant something only in the cell it left.
      item.sortOrder = await this.repository.nextSortOrder(category, stage);
      item.category = category;
      item.stage = stage;
    }

    item.updatedBy = currentUserId();
    return toAdminItem(await this.repository.save(item));
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const item = await this.findOrThrow(id);
    await this.repository.remove(item);
    return { success: true };
  }

  /**
   * Re-sequences one cell. `ids` must be exactly the cards in a single
   * category × stage cell — a partial list would leave the cards it omits
   * tied with the ones it numbers.
   */
  async reorder(ids: string[]): Promise<PublicRoadmapItemDto[]> {
    const items = await this.repository.find({ where: { id: In(ids) } });
    if (items.length !== ids.length) {
      throw new NotFoundException('One or more roadmap cards no longer exist');
    }

    const [{ category, stage }] = items;
    if (items.some((i) => i.category !== category || i.stage !== stage)) {
      throw new BadRequestException(
        'Cards can only be reordered within one category and stage',
      );
    }
    const cellSize = await this.repository.count({
      where: { category, stage },
    });
    if (cellSize !== ids.length) {
      throw new BadRequestException(
        'Send every card in the category and stage to reorder it',
      );
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    const userId = currentUserId();
    const reordered = ids.map((id, index) => {
      const item = byId.get(id)!;
      item.sortOrder = index;
      item.updatedBy = userId;
      return item;
    });
    const saved = await this.repository.manager.transaction((manager) =>
      manager.save(PublicRoadmapItem, reordered),
    );
    return saved.map(toAdminItem);
  }

  private async findOrThrow(id: string): Promise<PublicRoadmapItem> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Roadmap card not found');
    return item;
  }
}

function currentUserId(): number | null {
  const parsed = parseInt(ExecutionManager.getUserId() ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed text that must still say something once whitespace is gone. */
function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${field} cannot be empty`);
  return trimmed;
}

/** Trimmed text where blank means "none". */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The newest change among the cards on the page — what the page's date shows.
 * A card that was hidden or deleted no longer counts, so removing a card does
 * not move the date; adding or editing a visible one does.
 */
function latestUpdate(items: PublicRoadmapItem[]): string | null {
  let latest: Date | null = null;
  for (const item of items) {
    if (!latest || item.updatedAt > latest) latest = item.updatedAt;
  }
  return latest ? latest.toISOString() : null;
}

function toCard(item: PublicRoadmapItem): PublicRoadmapCardDto {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    note: item.note,
    category: item.category,
    stage: item.stage,
    sortOrder: item.sortOrder,
  };
}

function toAdminItem(item: PublicRoadmapItem): PublicRoadmapItemDto {
  return {
    ...toCard(item),
    isPublic: item.isPublic,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
