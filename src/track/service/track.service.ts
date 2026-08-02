import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, QueryFailedError } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ELIGBLE_APP_LANGUAGES } from 'src/common/constants/translation.constants';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { LoggerService } from 'src/logger/logger.service';
import { Track } from '../entity/track.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { TrackTenant } from '../entity/track-tenant.entity';
import { TrackRepository } from '../repository/track.repository';
import { TrackEnrollmentRepository } from '../repository/track-enrollment.repository';
import {
  TrackFilterOptions,
  TrackItemType,
  TrackStatus,
  TrackTranslations,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';
import {
  TRACK_DEFAULT_QUIZ_PASS_SCORE,
  TRACK_DEFAULT_VIDEO_WATCH_PCT,
  TRACK_REQUIRED_FIELDS_FOR_PUBLISH,
} from '../constants/track.constant';
import {
  CreateTrackDto,
  TrackSummaryResponseDto,
} from '../dto/create-track.dto';
import { UpdateTrackDto } from '../dto/update-track.dto';
import {
  UpsertTrackItemDto,
  UpsertTrackSectionDto,
  UpsertTrackStructureDto,
} from '../dto/upsert-track-structure.dto';
import {
  computeStructuralSignature,
  validateTrackStructure,
} from './track-structure.validator';
import { sanitizeDeep } from '../util/sanitize-structure.util';
import { TrackSharedService, TrackWithStructure } from './track-shared.service';

@Injectable()
export class TrackService {
  private readonly logger = LoggerService.getInstance(TrackService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackRepository: TrackRepository,
    private readonly trackEnrollmentRepository: TrackEnrollmentRepository,
    private readonly trackSharedService: TrackSharedService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly caseSharedService: CaseSharedService,
    private readonly tenantService: TenantService,
    private readonly openaiTranslationsService: OpenAITranslationsService,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}

  async getTracks(filters?: TrackFilterOptions) {
    if (filters?.tenantId) {
      const tenant = await this.tenantService.findById(filters.tenantId);
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }
    const result = await this.trackRepository.getAllTracks(filters);

    const tracks = result.data.map((track: any) => {
      const { trackTenant, ...trackData } = track;
      return {
        id: trackData.id,
        title: trackData.title,
        description: trackData.description,
        coverImageUrl: trackData.coverImageUrl,
        status: trackData.status,
        isGlobal: trackData.isGlobal,
        totalItems: trackData.totalItems,
        estimatedDurationMinutes: trackData.estimatedDurationMinutes,
        isAssignedToTenant: filters?.tenantId ? !!trackTenant : undefined,
        updatedAt: trackData.updatedAt,
      };
    });

    return { data: tracks, count: result.count };
  }

  async getTrackById(id: string): Promise<TrackWithStructure> {
    return this.trackSharedService.getTrackWithStructure(id);
  }

  async createTrack(
    createTrackDto: CreateTrackDto,
  ): Promise<TrackSummaryResponseDto> {
    const status = createTrackDto.status ?? TrackStatus.DRAFT;
    if (status === TrackStatus.ACTIVE) {
      throw new BadRequestException(
        'A track must be created as a draft and published once it has content.',
      );
    }
    const userId = this.getUserId();

    const track = await this.trackRepository.save({
      title: createTrackDto.title,
      description: createTrackDto.description,
      coverImageUrl: createTrackDto.coverImageUrl,
      isGlobal: createTrackDto.isGlobal ?? false,
      status,
      estimatedDurationMinutes: createTrackDto.estimatedDurationMinutes,
      ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
    });

    if (track.isGlobal) {
      await this.syncGlobalTenants(track.id, true);
    }
    void this.createTrackTranslations(track.id, {
      title: track.title,
      description: track.description,
    });
    this.logger.info(`Track ${track.id} created`);
    return this.toSummary(track);
  }

  async updateTrack(
    id: string,
    updateTrackDto: UpdateTrackDto,
  ): Promise<TrackSummaryResponseDto> {
    const track = await this.trackRepository.findOne({ where: { id } });
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const targetStatus = updateTrackDto.status ?? track.status;

    if (
      track.status === TrackStatus.ACTIVE &&
      targetStatus === TrackStatus.DRAFT
    ) {
      const hasEnrollments =
        await this.trackEnrollmentRepository.existsForTrack(id);
      if (hasEnrollments) {
        throw new BadRequestException(
          'This track cannot be moved back to draft because learners are enrolled in it. Archive it instead.',
        );
      }
    }

    if (
      targetStatus === TrackStatus.ACTIVE &&
      track.status !== TrackStatus.ACTIVE
    ) {
      await this.validateTrackForPublish(id, {
        ...track,
        ...updateTrackDto,
      });
    }

    const userId = this.getUserId();
    await this.trackRepository.update(id, {
      title: updateTrackDto.title ?? track.title,
      description: updateTrackDto.description ?? track.description,
      coverImageUrl: updateTrackDto.coverImageUrl ?? track.coverImageUrl,
      isGlobal: updateTrackDto.isGlobal ?? track.isGlobal,
      estimatedDurationMinutes:
        updateTrackDto.estimatedDurationMinutes ??
        track.estimatedDurationMinutes,
      status: targetStatus,
      ...(userId ? { updatedBy: userId } : {}),
    });

    if (
      updateTrackDto.isGlobal !== undefined &&
      updateTrackDto.isGlobal !== track.isGlobal
    ) {
      await this.syncGlobalTenants(id, updateTrackDto.isGlobal);
    }

    if (
      this.checkIfTranslationRequired(track, {
        title: updateTrackDto.title,
        description: updateTrackDto.description,
      })
    ) {
      void this.createTrackTranslations(id, {
        title: updateTrackDto.title,
        description: updateTrackDto.description,
      });
    }

    const updated = await this.trackRepository.findOne({ where: { id } });
    this.logger.info(`Track ${id} updated`);
    return this.toSummary(updated!);
  }

  /**
   * Whole-tree upsert of sections+items: ids present = update, absent =
   * create, missing = soft delete. Structural edits are rejected once the
   * track has enrollments (learner progress rows point at stable item ids) —
   * content-safe edits (titles, article html, prompt text, explanations)
   * remain allowed.
   */
  async upsertStructure(
    id: string,
    dto: UpsertTrackStructureDto,
  ): Promise<SuccessResponse> {
    const track = await this.trackRepository.findOne({ where: { id } });
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    this.sanitizeStructure(dto.sections);
    validateTrackStructure(dto.sections);
    this.applyContentDefaults(dto.sections);
    await this.validateReferences(dto.sections);

    const existing = await this.trackSharedService.getTrackWithStructure(id);
    const existingSectionIds = new Set(existing.sections.map((s) => s.id));
    const existingItemIds = new Set(
      existing.sections.flatMap((s) => s.items.map((i) => i.id)),
    );

    // Incoming ids must belong to this track.
    for (const section of dto.sections) {
      if (section.id && !existingSectionIds.has(section.id)) {
        throw new BadRequestException(
          `Section ${section.id} does not belong to this track`,
        );
      }
      for (const item of section.items) {
        if (item.id && !existingItemIds.has(item.id)) {
          throw new BadRequestException(
            `Item ${item.id} does not belong to this track`,
          );
        }
      }
    }

    const hasEnrollments =
      await this.trackEnrollmentRepository.existsForTrack(id);
    if (hasEnrollments) {
      const existingSignature = computeStructuralSignature(
        this.toUpsertShape(existing),
      );
      const incomingSignature = computeStructuralSignature(dto.sections);
      if (existingSignature !== incomingSignature) {
        throw new ConflictException(
          'Learners are enrolled in this track, so its structure is locked. Duplicate the track to restructure it, then publish the copy.',
        );
      }
    }

    const totalItems = dto.sections.reduce(
      (sum, section) => sum + section.items.length,
      0,
    );
    const userId = this.getUserId();

    try {
      await this.dataSource.transaction(async (manager) => {
        const sectionRepo = manager.getRepository(TrackSection);
        const itemRepo = manager.getRepository(TrackItem);

        const incomingSectionIds = dto.sections
          .map((s) => s.id)
          .filter((sid): sid is string => !!sid);
        const incomingItemIds = dto.sections
          .flatMap((s) => s.items.map((i) => i.id))
          .filter((iid): iid is string => !!iid);

        const removedSectionIds = [...existingSectionIds].filter(
          (sid) => !incomingSectionIds.includes(sid),
        );
        const removedItemIds = [...existingItemIds].filter(
          (iid) => !incomingItemIds.includes(iid),
        );
        if (removedSectionIds.length > 0) {
          await sectionRepo.softDelete({ id: In(removedSectionIds) });
        }
        if (removedItemIds.length > 0) {
          await itemRepo.softDelete({ id: In(removedItemIds) });
        }

        // `idx_track_sections_track_id_order` / `idx_track_items_section_id_order`
        // are non-deferred unique indexes: Postgres checks them per statement, not
        // at commit. If a section/item's order shifted (e.g. a component was
        // inserted or removed earlier in the section), the final order values are
        // unique, but updating rows one at a time in array order can transiently
        // collide with another row that still holds its old value. Detach existing
        // rows to negative placeholder orders first so no intermediate state can
        // clash, then apply the real target orders below.
        const existingSectionUpdates = dto.sections.filter((s) => s.id);
        for (const [idx, section] of existingSectionUpdates.entries()) {
          await sectionRepo.update(section.id!, { order: -(idx + 1) });
        }
        for (const section of dto.sections) {
          const existingItemUpdates = section.items.filter((i) => i.id);
          for (const [idx, item] of existingItemUpdates.entries()) {
            await itemRepo.update(item.id!, { order: -(idx + 1) });
          }
        }

        for (const section of dto.sections) {
          const savedSection = await sectionRepo.save({
            ...(section.id ? { id: section.id } : {}),
            trackId: id,
            title: section.title,
            description: section.description,
            order: section.order,
          });
          for (const item of section.items) {
            await itemRepo.save({
              ...(item.id ? { id: item.id } : {}),
              trackId: id,
              trackSectionId: savedSection.id,
              type: item.type,
              order: item.order,
              title: item.title,
              description: item.description,
              scenarioId:
                item.type === TrackItemType.ROLEPLAY ? item.scenarioId : null,
              caseId: item.type === TrackItemType.CASE ? item.caseId : null,
              content: item.content ?? null,
              completionCriteria: item.completionCriteria ?? null,
            } as Partial<TrackItem>);
          }
        }

        await manager.getRepository(Track).update(id, {
          totalItems,
          ...(userId ? { updatedBy: userId } : {}),
        });
      });
    } catch (err) {
      if (err instanceof QueryFailedError) {
        this.logger.error(`Track ${id} structure save failed: ${err.message}`);
        throw new BadRequestException(
          `Could not save the course structure: ${err.message}`,
        );
      }
      throw err;
    }

    this.logger.info(`Track ${id} structure saved (${totalItems} items)`);
    return { success: true };
  }

  async deleteTrack(id: string): Promise<SuccessResponse> {
    const track = await this.trackRepository.findOne({ where: { id } });
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const hasEnrollments =
      await this.trackEnrollmentRepository.existsForTrack(id);
    if (hasEnrollments) {
      throw new BadRequestException(
        'Cannot delete a track with enrolled learners. Archive it instead.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Track).softDelete(id);
      await manager.getRepository(TrackSection).softDelete({ trackId: id });
      await manager.getRepository(TrackItem).softDelete({ trackId: id });
      await manager.getRepository(TrackTenant).softDelete({ trackId: id });
    });
    this.logger.info(`Track ${id} deleted`);
    return { success: true };
  }

  async duplicateTrack(id: string): Promise<TrackSummaryResponseDto> {
    const source = await this.trackSharedService.getTrackWithStructure(id);
    const userId = this.getUserId();

    return this.dataSource.transaction(async (manager) => {
      const trackRepo = manager.getRepository(Track);
      const sectionRepo = manager.getRepository(TrackSection);
      const itemRepo = manager.getRepository(TrackItem);

      const newTrack = await trackRepo.save({
        title: `Copy of ${source.title}`,
        description: source.description,
        coverImageUrl: source.coverImageUrl,
        status: TrackStatus.DRAFT,
        isGlobal: source.isGlobal,
        totalItems: source.totalItems,
        estimatedDurationMinutes: source.estimatedDurationMinutes,
        translations: source.translations,
        ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
      });

      for (const section of source.sections) {
        const newSection = await sectionRepo.save({
          trackId: newTrack.id,
          title: section.title,
          description: section.description,
          order: section.order,
          translations: section.translations,
        });
        if (section.items.length > 0) {
          await itemRepo.save(
            section.items.map((item) => ({
              trackId: newTrack.id,
              trackSectionId: newSection.id,
              type: item.type,
              order: item.order,
              title: item.title,
              description: item.description,
              scenarioId: item.scenarioId,
              caseId: item.caseId,
              content: item.content,
              completionCriteria: item.completionCriteria,
              translations: item.translations,
            })),
          );
        }
      }

      if (newTrack.isGlobal) {
        const tenants = await this.tenantService.findAll();
        const tenantRepo = manager.getRepository(TrackTenant);
        await tenantRepo.save(
          tenants.map((tenant) =>
            tenantRepo.create({ trackId: newTrack.id, tenantId: tenant.id }),
          ),
        );
      }

      this.logger.info(`Track ${id} duplicated as ${newTrack.id}`);
      return this.toSummary(newTrack);
    });
  }

  async makeTranslationsForTracks(): Promise<boolean> {
    const tracks = await this.trackRepository.find({
      select: ['id', 'title', 'description'],
    });
    for (const track of tracks) {
      const translations =
        await this.openaiTranslationsService.translateObjectToLanguages(
          { title: track.title, description: track.description },
          ELIGBLE_APP_LANGUAGES,
          'openai_translation_speech_reexpression_user',
        );
      if (translations) {
        await this.trackRepository.update(track.id, { translations } as any);
      }
    }
    return true;
  }

  private async validateTrackForPublish(
    id: string,
    trackData: Partial<Track>,
  ): Promise<void> {
    const missingFields = TRACK_REQUIRED_FIELDS_FOR_PUBLISH.filter(
      (field) => !trackData[field as keyof Track],
    );
    if (missingFields.length > 0) {
      throw new BadRequestException(
        `The following required fields are missing: ${missingFields.join(', ')}`,
      );
    }

    const structure = await this.trackSharedService.getTrackWithStructure(id);
    if (structure.sections.length === 0) {
      throw new BadRequestException(
        'A track must contain at least one section to be published.',
      );
    }
    for (const section of structure.sections) {
      if (section.items.length === 0) {
        throw new BadRequestException(
          `Section "${section.title}" must contain at least one component to be published.`,
        );
      }
    }
    await this.validateReferences(this.toUpsertShape(structure));
  }

  /** Verify scenario/case references exist and are active. */
  private async validateReferences(
    sections: UpsertTrackSectionDto[],
  ): Promise<void> {
    const items = sections.flatMap((s) => s.items);
    const scenarioIds = [
      ...new Set(
        items
          .filter((i) => i.type === TrackItemType.ROLEPLAY && i.scenarioId)
          .map((i) => i.scenarioId!),
      ),
    ];
    if (scenarioIds.length > 0) {
      const scenarios = await this.scenarioSharedService.getScenarioByIds(
        scenarioIds,
        { status: ScenarioStatus.ACTIVE },
      );
      const foundIds = new Set(scenarios.map((s) => s.id));
      const missing = scenarioIds.filter((sid) => !foundIds.has(sid));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Invalid or inactive scenario IDs: ${missing.join(', ')}`,
        );
      }
    }

    const caseIds = [
      ...new Set(
        items
          .filter((i) => i.type === TrackItemType.CASE && i.caseId)
          .map((i) => i.caseId!),
      ),
    ];
    for (const caseId of caseIds) {
      const caseEntity = await this.caseSharedService.getActiveCaseById(caseId);
      if (!caseEntity) {
        throw new BadRequestException(`Invalid or inactive case ID: ${caseId}`);
      }
    }
  }

  /** Strips characters Postgres rejects in text/jsonb (NUL bytes, lone surrogates) from free text. */
  private sanitizeStructure(sections: UpsertTrackSectionDto[]): void {
    for (const section of sections) {
      section.title = sanitizeDeep(section.title);
      if (section.description !== undefined) {
        section.description = sanitizeDeep(section.description);
      }
      for (const item of section.items) {
        item.title = sanitizeDeep(item.title);
        if (item.description !== undefined) {
          item.description = sanitizeDeep(item.description);
        }
        if (item.content !== undefined) {
          item.content = sanitizeDeep(item.content);
        }
      }
    }
  }

  /** Fill in completion-criteria defaults and keep quiz passScore mirrored. */
  private applyContentDefaults(sections: UpsertTrackSectionDto[]): void {
    for (const section of sections) {
      for (const item of section.items) {
        if (item.type === TrackItemType.QUIZ && item.content) {
          const quiz = item.content as QuizContent;
          quiz.settings.passScore =
            quiz.settings.passScore ?? TRACK_DEFAULT_QUIZ_PASS_SCORE;
          item.completionCriteria = {
            ...item.completionCriteria,
            passScore: quiz.settings.passScore,
          };
        }
        if (item.type === TrackItemType.VIDEO) {
          item.completionCriteria = {
            ...item.completionCriteria,
            watchPct:
              item.completionCriteria?.watchPct ??
              TRACK_DEFAULT_VIDEO_WATCH_PCT,
          };
        }
      }
    }
  }

  private toUpsertShape(
    structure: TrackWithStructure,
  ): UpsertTrackSectionDto[] {
    return structure.sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      order: section.order,
      items: section.items.map(
        (item) =>
          ({
            id: item.id,
            type: item.type,
            order: item.order,
            title: item.title,
            description: item.description,
            scenarioId: item.scenarioId ?? undefined,
            caseId: item.caseId ?? undefined,
            content: item.content as Record<string, any> | undefined,
            completionCriteria: item.completionCriteria ?? undefined,
          }) as UpsertTrackItemDto,
      ),
    }));
  }

  private toSummary(track: Track): TrackSummaryResponseDto {
    return {
      id: track.id,
      title: track.title,
      description: track.description,
      coverImageUrl: track.coverImageUrl,
      status: track.status,
    };
  }

  private getUserId(): number | undefined {
    const userIdStr = ExecutionManager.getUserId();
    return userIdStr ? Number(userIdStr) : undefined;
  }

  private async syncGlobalTenants(
    trackId: string,
    isGlobal: boolean,
  ): Promise<void> {
    const tenants = await this.tenantService.findAll();
    const tenantIds = tenants.map((tenant) => tenant.id);
    const tenantRepo = this.dataSource.getRepository(TrackTenant);
    if (isGlobal) {
      await tenantRepo.delete({ trackId });
      await tenantRepo.save(
        tenantIds.map((tenantId) => tenantRepo.create({ trackId, tenantId })),
      );
    } else {
      await tenantRepo.delete({ trackId, tenantId: In(tenantIds) });
    }
  }

  private async createTrackTranslations(
    trackId: string,
    trackData: TrackTranslations,
  ): Promise<void> {
    try {
      if (!trackData.title && !trackData.description) return;
      const validLanguageIds =
        await this.scenarioSharedService.getUniqueLanguagesFromScenarioTranslations();
      if (!validLanguageIds || validLanguageIds.length === 0) return;

      let languageCodes =
        await this.sharedLanguageService.getValidLanguageCodes(
          validLanguageIds,
        );
      languageCodes = languageCodes?.filter((languageCode) =>
        ELIGBLE_APP_LANGUAGES.includes(languageCode),
      );
      if (!languageCodes || languageCodes.length === 0) return;

      const translations =
        await this.openaiTranslationsService.translateObjectToLanguages(
          trackData,
          languageCodes,
          'openai_translation_speech_reexpression_user',
        );
      if (translations) {
        await this.trackRepository.update(trackId, { translations } as any);
      }
    } catch (error) {
      this.logger.error(
        `Failed to create translations for track ${trackId}: ${error}`,
      );
    }
  }

  private checkIfTranslationRequired(
    oldData: TrackTranslations,
    newData: TrackTranslations,
  ): boolean {
    const { title, description } = newData;
    if (title === undefined && description === undefined) return false;
    return (
      title?.trim().toLowerCase() !== oldData.title?.trim().toLowerCase() ||
      description?.trim().toLowerCase() !==
        oldData.description?.trim().toLowerCase()
    );
  }
}
