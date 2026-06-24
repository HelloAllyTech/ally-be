import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { ScenarioVersion } from '../entity/scenario-version.entity';
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioVersionStatus } from '../enum/scenario-version-status.enum';
import { ScenarioVersionRepository } from '../repository/scenario-version.repository';
import { ScenariosRepository } from '../repository/scenario.repository';
import { CreateScenarioVersionDto } from '../dto/create-scenario-version.dto';
import { UpdateScenarioVersionDto } from '../dto/update-scenario-version.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { ScenarioService } from './scenario.service';
import { ScenarioStatus } from '../type/scenario.type';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import { PermissionsService } from 'src/authorization/service/permissions.service';

@Injectable()
export class ScenarioVersionService {
  constructor(
    private readonly scenarioVersionRepository: ScenarioVersionRepository,
    private readonly scenariosRepository: ScenariosRepository,
    private readonly scenarioService: ScenarioService,
    private readonly permissionsService: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * List versions for a scenario (newest first). Lazily seeds a v1 from the
   * current live scenario if none exist yet, so scenarios created before
   * versioning — or via the legacy create path — always have a baseline.
   */
  async listVersions(scenarioId: number): Promise<ScenarioVersion[]> {
    const scenario = await this.requireScenario(scenarioId);
    const existing =
      await this.scenarioVersionRepository.listByScenario(scenarioId);
    if (existing.length > 0) {
      return existing;
    }
    await this.ensureInitialVersion(scenario);
    return this.scenarioVersionRepository.listByScenario(scenarioId);
  }

  async getVersion(
    scenarioId: number,
    versionId: string,
  ): Promise<ScenarioVersion> {
    const version = await this.scenarioVersionRepository.findOne({
      where: { id: versionId, scenarioId },
    });
    if (!version) {
      throw new NotFoundException('Scenario version not found');
    }
    return version;
  }

  /**
   * Create a new draft. Config is cloned from `fromVersionId`, else from the
   * published version, else reconstructed from the live scenario state.
   */
  async createVersion(
    scenarioId: number,
    dto: CreateScenarioVersionDto,
    userId: number,
  ): Promise<ScenarioVersion> {
    const scenario = await this.requireScenario(scenarioId);
    await this.assertOwnership(scenario, userId);

    let parentVersionId: string | null = null;
    let config: Record<string, any>;

    if (dto.empty) {
      // A blank variant authored from scratch (no parent, no cloned data).
      // mappedEvents:[] (not undefined) marks it as "explicitly no events" so
      // the editor shows an empty event table rather than falling back to the
      // live scenario's events.
      config = { mappedEvents: [] };
    } else if (dto.fromVersionId) {
      // Branch: fork an existing version's data into a new draft.
      const parent = await this.getVersion(scenarioId, dto.fromVersionId);
      parentVersionId = parent.id;
      // The published version's stored config is a snapshot that can drift from
      // the live scenario when it's edited directly (outside the version
      // system). Rebuild from the live state so branching the published version
      // always captures current edits. Drafts/archived snapshots are authored
      // in the version system (or intentionally frozen), so clone them as-is.
      config =
        parent.status === ScenarioVersionStatus.PUBLISHED
          ? await this.buildConfigFromScenario(scenarioId)
          : (parent.config ?? {});
    } else {
      // Default: seed from the published version, else the live scenario. The
      // published snapshot can be stale (see above), so always rebuild from live.
      const published = scenario.publishedVersionId
        ? await this.scenarioVersionRepository.findOne({
            where: { id: scenario.publishedVersionId, scenarioId },
          })
        : null;
      parentVersionId = published?.id ?? null;
      config = await this.buildConfigFromScenario(scenarioId);
    }

    // getNextVersionNumber is a read-then-insert, so two concurrent creates can
    // pick the same number and collide on the unique (scenarioId, versionNumber)
    // index. Retry a few times — each attempt recomputes the next number.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction(async (em) => {
          const versionNumber =
            await this.scenarioVersionRepository.getNextVersionNumber(
              scenarioId,
              em,
            );
          const repo = em.getRepository(ScenarioVersion);
          const version = repo.create({
            scenarioId,
            versionNumber,
            name: dto.name,
            // Drafts are never themselves live, so force a DRAFT status into the
            // cloned config to avoid carrying an ACTIVE flag from the parent.
            config: { ...config, status: ScenarioStatus.DRAFT },
            status: ScenarioVersionStatus.DRAFT,
            parentVersionId,
            createdBy: userId,
            updatedBy: userId,
          });
          return repo.save(version);
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isDuplicateKeyException(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Autosave a draft. Writes the snapshot straight to `config`; the live
   * scenario is untouched until the version is published.
   */
  async updateVersion(
    scenarioId: number,
    versionId: string,
    dto: UpdateScenarioVersionDto,
    userId: number,
  ): Promise<ScenarioVersion> {
    const version = await this.getVersion(scenarioId, versionId);
    await this.assertOwnership(await this.requireScenario(scenarioId), userId);

    // Config edits are draft-only (published/archived snapshots are immutable);
    // renaming is a label change, allowed on any status.
    if (dto.config !== undefined) {
      if (version.status !== ScenarioVersionStatus.DRAFT) {
        throw new BadRequestException(
          'Only draft versions can be edited. Branch this version into a new draft to make changes.',
        );
      }
      version.config = { ...dto.config, status: ScenarioStatus.DRAFT };
    }
    if (dto.name !== undefined) {
      version.name = dto.name;
    }
    version.updatedBy = userId;
    return this.scenarioVersionRepository.save(version);
  }

  async deleteVersion(
    scenarioId: number,
    versionId: string,
    userId: number,
  ): Promise<boolean> {
    const version = await this.getVersion(scenarioId, versionId);
    if (version.status === ScenarioVersionStatus.PUBLISHED) {
      throw new BadRequestException(
        'Cannot delete the published version. Publish another version first.',
      );
    }
    await this.assertOwnership(await this.requireScenario(scenarioId), userId);
    await this.scenarioVersionRepository.softDelete(version.id);
    return true;
  }

  /**
   * Publish a version: replay its config through the existing updateScenario
   * fan-out (status forced ACTIVE), mark this version PUBLISHED, archive the
   * previously-published one, and point the scenario at it.
   */
  async publishVersion(
    scenarioId: number,
    versionId: string,
    userId: number,
  ): Promise<ScenarioVersion> {
    const scenario = await this.requireScenario(scenarioId);
    await this.assertOwnership(scenario, userId);
    const version = await this.getVersion(scenarioId, versionId);

    const config: UpdateScenarioDto = {
      ...(version.config as UpdateScenarioDto),
      status: ScenarioStatus.ACTIVE,
    };
    const mappedEvents = (version.config as Record<string, any>)?.mappedEvents;

    // Everything publish mutates — the live scenario + related tables, the
    // event mappings (a separate table), and the version-status/pointer flip —
    // runs in ONE transaction so a mid-publish failure can't leave the live
    // scenario half-updated. updateScenario/mapEventsToScenario/
    // deleteScenarioEvents each accept this manager and skip opening their own
    // transaction. (Note: updateScenario's translation upserts still run on the
    // main connection afterwards, as they always have — translations remain
    // eventually-consistent.)
    return this.dataSource.transaction(async (em) => {
      // 1. Materialise the snapshot into the live scenario + related tables.
      await this.scenarioService.updateScenario(scenarioId, config, userId, em);

      // 2. Full-replace event mappings: delete live events absent from the
      // draft, upsert the rest. Undefined => never captured (skip, don't
      // touch live). Empty array => explicitly no events (clear all).
      if (Array.isArray(mappedEvents)) {
        const liveEvents =
          await this.scenarioService.getScenarioEvents(scenarioId);
        const desiredIds = new Set(
          mappedEvents.map((e) => e.id ?? e.eventId).filter(Boolean),
        );
        const idsToDelete = (liveEvents?.data ?? [])
          .map((e: Record<string, any>) => e.eventId ?? e.id)
          .filter((id: string) => id && !desiredIds.has(id));
        if (idsToDelete.length > 0) {
          await this.scenarioService.deleteScenarioEvents(
            { scenarioId, eventIds: idsToDelete },
            em,
          );
        }
        if (mappedEvents.length > 0) {
          await this.scenarioService.mapEventsToScenario(
            { scenarioId, events: mappedEvents },
            em,
          );
        }
      }

      // 3. Flip version statuses + the live pointer.
      const versionRepo = em.getRepository(ScenarioVersion);
      const scenarioRepo = em.getRepository(Scenarios);

      // Demote any other currently-published version of this scenario.
      await versionRepo.update(
        { scenarioId, status: ScenarioVersionStatus.PUBLISHED },
        { status: ScenarioVersionStatus.ARCHIVED, updatedBy: userId },
      );
      await versionRepo.update(version.id, {
        status: ScenarioVersionStatus.PUBLISHED,
        updatedBy: userId,
      });
      await scenarioRepo.update(scenarioId, { publishedVersionId: version.id });

      return versionRepo.findOneOrFail({ where: { id: version.id } });
    });
  }

  /**
   * Seed the baseline v1 from the live scenario. Idempotent: a no-op if a
   * version already exists. Marked PUBLISHED when the scenario is live so the
   * scenario's publishedVersionId resolves correctly.
   */
  async ensureInitialVersion(scenario: Scenarios): Promise<ScenarioVersion> {
    const existing = await this.scenarioVersionRepository.findOne({
      where: { scenarioId: scenario.id },
    });
    if (existing) {
      return existing;
    }
    const config = await this.buildConfigFromScenario(scenario.id);
    const isLive = scenario.status === ScenarioStatus.ACTIVE;

    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(ScenarioVersion);
      const version = await repo.save(
        repo.create({
          scenarioId: scenario.id,
          versionNumber: 1,
          // No code name — the UI shows the auto "v1" label. A name is an
          // optional admin-supplied code name, not the version number.
          config,
          status: isLive
            ? ScenarioVersionStatus.PUBLISHED
            : ScenarioVersionStatus.DRAFT,
          createdBy: scenario.createdBy,
          updatedBy: scenario.updatedBy ?? scenario.createdBy,
        }),
      );
      if (isLive) {
        await em
          .getRepository(Scenarios)
          .update(scenario.id, { publishedVersionId: version.id });
      }
      return version;
    });
  }

  /**
   * Reconstruct an UpdateScenarioDto-shaped config from the live scenario.
   * Flattens metadata to top level (the form/DTO shape) and pulls related
   * arrays so a future publish round-trips faithfully.
   */
  private async buildConfigFromScenario(
    scenarioId: number,
  ): Promise<Record<string, any>> {
    const admin: GetAdminScenarioDto =
      await this.scenarioService.getAdminScenario(scenarioId);
    const metadata = admin.metadata ?? {};
    // Snapshot the live event mappings (separate table) in the map-events input
    // shape so the frontend can load them and publish can replay them. `id` is
    // normalised from `eventId` for the publish path.
    const eventsResult =
      await this.scenarioService.getScenarioEvents(scenarioId);
    const mappedEvents = (eventsResult?.data ?? []).map(
      (e: Record<string, any>) => ({
        ...e,
        id: e.eventId ?? e.id,
      }),
    );
    return {
      mappedEvents,
      ...metadata,
      title: admin.title,
      description: admin.description,
      prompt: admin.prompt,
      coverImageUrl: admin.coverImageUrl,
      coverVideoUrl: admin.coverVideoUrl,
      isPublic: admin.isPublic,
      isGlobal: admin.isGlobal,
      difficultyLevel: admin.difficultyLevel,
      competencyId: admin.competencyId,
      status: ScenarioStatus.DRAFT,
      triggerWarningIds: (admin.triggerWarnings ?? []).map((tw: any) =>
        String(tw.id),
      ),
      terminationEvents: admin.terminationEvents ?? [],
      behaviorInstructions: admin.behaviorInstructions ?? [],
    };
  }

  private async requireScenario(scenarioId: number): Promise<Scenarios> {
    const scenario = await this.scenariosRepository.findOne({
      where: { id: scenarioId },
    });
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }
    return scenario;
  }

  private async assertOwnership(
    scenario: Scenarios,
    userId: number,
  ): Promise<void> {
    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    if (isMultiTenantAdmin && scenario.createdBy !== userId) {
      throw new ForbiddenException('You can only edit your own roleplays');
    }
  }
}
