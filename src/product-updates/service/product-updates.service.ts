import { BadRequestException, Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { NotFoundException } from 'src/exception/custom.exception';
import { LoggerService } from 'src/logger/logger.service';

import { EditableUpdateField } from '../constants/product-update.constants';
import {
  GetProductUpdatesDto,
  GetProductUpdatesResponseDto,
  GetPublicProductUpdatesDto,
  GetPublicProductUpdatesResponseDto,
  ProductUpdateDto,
  ProductUpdatesStatusDto,
  TriggerProductUpdatesRunResponseDto,
  UpdateProductUpdateDto,
} from '../dto/product-update.dto';
import { ProductUpdate } from '../entity/product-update.entity';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../repository/product-update.repository';
import { ProductUpdatePipelineService } from './product-update-pipeline.service';

const PUBLIC_DEFAULT_LIMIT = 30;
const PUBLIC_MAX_LIMIT = 100;

/** Public, live and not hidden — the one definition the page, the admin list and the digest share. */
export function isPublic(update: ProductUpdate): boolean {
  return (
    update.audience === 'public' && !update.hidden && Boolean(update.liveAt)
  );
}

@Injectable()
export class ProductUpdatesService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdatesService.name,
  );

  constructor(
    private readonly updateRepository: ProductUpdateRepository,
    private readonly sourceRepository: ProductUpdateSourceRepository,
    private readonly pipeline: ProductUpdatePipelineService,
    private readonly configService: AppConfigService,
  ) {}

  async listPublic(
    query: GetPublicProductUpdatesDto,
  ): Promise<GetPublicProductUpdatesResponseDto> {
    const limit = Math.min(
      Math.max(query.limit ?? PUBLIC_DEFAULT_LIMIT, 1),
      PUBLIC_MAX_LIMIT,
    );
    const offset = Math.max(query.offset ?? 0, 0);
    const { updates, count } = await this.updateRepository.findPublic({
      limit,
      offset,
      surface: query.surface,
    });
    return {
      updates: updates.map((update) => ({
        id: update.id,
        slug: update.slug,
        title: update.title,
        summary: update.summary,
        kind: update.kind,
        surfaces: update.surfaces,
        area: update.area,
        liveAt: update.liveAt!,
      })),
      count,
    };
  }

  async listAdmin(
    query: GetProductUpdatesDto,
  ): Promise<GetProductUpdatesResponseDto> {
    const { updates, count } = await this.updateRepository.findAdmin({
      status: query.status,
      audience: query.audience,
      surface: query.surface,
      hidden: query.hidden,
      search: query.search,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
    const sourceCounts = await this.sourceCounts(
      updates.map((update) => update.id),
    );
    return {
      updates: updates.map((update) =>
        this.toDto(update, sourceCounts.get(update.id) ?? 0, false),
      ),
      count,
    };
  }

  async get(id: string): Promise<ProductUpdateDto> {
    const update = await this.updateRepository.findOne({
      where: { id },
      relations: { sources: true },
    });
    if (!update) throw new NotFoundException('Product update not found');
    return this.toDto(update, update.sources?.length ?? 0, true);
  }

  /**
   * A person's correction. Every field sent is added to `editedFields`, so the
   * consolidation job never writes it again — including a field sent unchanged,
   * because saving it is a statement that it is right.
   */
  async update(
    id: string,
    dto: UpdateProductUpdateDto,
  ): Promise<ProductUpdateDto> {
    const update = await this.updateRepository.findOne({
      where: { id },
      relations: { sources: true },
    });
    if (!update) throw new NotFoundException('Product update not found');

    const edited = new Set<EditableUpdateField>(update.editedFields);
    const fields: EditableUpdateField[] = [
      'title',
      'summary',
      'teamNotes',
      'kind',
      'audience',
      'surfaces',
      'area',
    ];
    for (const field of fields) {
      const value = dto[field];
      if (value === undefined) continue;
      (update as unknown as Record<string, unknown>)[field] =
        typeof value === 'string' ? value.trim() : value;
      edited.add(field);
    }
    if (dto.hidden !== undefined) update.hidden = dto.hidden;
    if (!update.title || !update.summary) {
      throw new BadRequestException('An update needs a title and a summary.');
    }

    update.editedFields = [...edited];
    update.editedBy = this.userId();
    update.editedAt = new Date();
    // Made public by hand after it was already live: it appears now.
    if (isPublic(update) && !update.publishedAt)
      update.publishedAt = new Date();

    const saved = await this.updateRepository.save(update);
    this.logger.info(
      `Product update ${saved.id} edited by user ${update.editedBy}: ${Object.keys(dto).join(', ')}`,
    );
    return this.toDto(saved, saved.sources?.length ?? 0, true);
  }

  async status(): Promise<ProductUpdatesStatusDto> {
    const [sources, total, publicCount, waiting, lastRun, running] =
      await Promise.all([
        this.sourceRepository.countByStatus(),
        this.updateRepository.count(),
        this.updateRepository.count({
          where: { audience: 'public', hidden: false, liveAt: Not(IsNull()) },
        }),
        this.updateRepository.count({ where: { liveAt: IsNull() } }),
        this.pipeline.lastRun(),
        this.pipeline.isRunning(),
      ]);
    return {
      enabled: this.pipeline.enabled,
      digestConfigured: this.configService.productUpdates.digestTo.length > 0,
      sources,
      updates: { total, public: publicCount, waiting },
      running,
      lastRun: lastRun as unknown as Record<string, unknown> | null,
    };
  }

  /**
   * Starts a pass in the background and answers at once — a backfill runs for
   * the better part of an hour. The pass's own lock turns a second click into a
   * no-op, so this reports "already running" rather than queueing another.
   */
  async triggerRun(
    backfill: boolean,
  ): Promise<TriggerProductUpdatesRunResponseDto> {
    if (await this.pipeline.isRunning()) {
      return { started: false, reason: 'A run is already in progress.' };
    }
    void this.pipeline
      .run(backfill ? 'backfill' : 'manual')
      .then((result) => {
        if (!result)
          this.logger.info(
            '[PRODUCT-UPDATES] Run skipped: one is already in progress.',
          );
      })
      .catch((error) =>
        this.logger.error(
          `[PRODUCT-UPDATES] Manual run crashed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    return { started: true };
  }

  private async sourceCounts(
    updateIds: string[],
  ): Promise<Map<string, number>> {
    if (updateIds.length === 0) return new Map();
    const rows: { updateId: string; count: string }[] =
      await this.sourceRepository
        .createQueryBuilder('s')
        .select('s.update_id', 'updateId')
        .addSelect('COUNT(*)', 'count')
        .where('s.update_id IN (:...ids)', { ids: updateIds })
        .groupBy('s.update_id')
        .getRawMany();
    return new Map(rows.map((row) => [row.updateId, Number(row.count)]));
  }

  private toDto(
    update: ProductUpdate,
    sourceCount: number,
    withSources: boolean,
  ): ProductUpdateDto {
    return {
      id: update.id,
      slug: update.slug,
      title: update.title,
      summary: update.summary,
      teamNotes: update.teamNotes,
      kind: update.kind,
      audience: update.audience,
      surfaces: update.surfaces,
      area: update.area,
      confidence: update.confidence,
      hidden: update.hidden,
      isPublic: isPublic(update),
      editedFields: update.editedFields,
      firstMergedAt: update.firstMergedAt,
      lastMergedAt: update.lastMergedAt,
      liveAt: update.liveAt,
      publishedAt: update.publishedAt,
      decisionReason: update.decisionReason,
      model: update.model,
      sourceCount,
      sources: withSources
        ? (update.sources ?? [])
            .slice()
            .sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())
            .map((source) => ({
              id: source.id,
              repo: source.repo,
              prNumber: source.prNumber,
              prUrl: source.prUrl,
              author: source.author,
              subjects: source.subjects,
              mergedAt: source.mergedAt,
              liveAt: source.liveAt,
              deployables: source.deployables,
              gatesLiveness: source.gatesLiveness,
            }))
        : undefined,
    };
  }

  private userId(): number | null {
    const id = ExecutionManager.getUserId();
    return id ? Number(id) : null;
  }
}
