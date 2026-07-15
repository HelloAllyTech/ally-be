import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { ScenarioTenants } from 'src/learn/entity/scenario-tenants.entity';
import { ScenarioEngine } from 'src/learn/enum/scenario-engine.enum';
import { ScenarioStatus } from 'src/learn/type/scenario.type';
import isDuplicateKeyException from 'src/exception/custom.exception';
import { SuccessResponse } from 'src/common/type/common.type';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';
import { RoleplaySpecVersion } from '../entity/roleplay-spec-version.entity';
import { RoleplaySpecTenant } from '../entity/roleplay-spec-tenant.entity';
import { RoleplaySpecStatus } from '../enum/roleplay-spec-status.enum';
import { RoleplaySpecVersionStatus } from '../enum/roleplay-spec-version-status.enum';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import { RoleplaySpecRepository } from '../repository/roleplay-spec.repository';
import { RoleplaySpecVersionRepository } from '../repository/roleplay-spec-version.repository';
import { RoleplaySpecTenantRepository } from '../repository/roleplay-spec-tenant.repository';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { SpecValidatorService } from './spec-validator.service';
import {
  RoleplaySpecDocument,
  SPEC_SCHEMA_VERSION,
  SpecValidationResult,
} from '../type/roleplay-spec-document.type';
import {
  CreateRoleplaySpecDto,
  CreateRoleplaySpecVersionDto,
  ListRoleplaySpecsQueryDto,
  UpdateRoleplaySpecDraftDto,
  UpdateRoleplaySpecDto,
} from '../dto/roleplay-spec.dto';

/**
 * CRUD + versioning + publish for Roleplay Studio v2 specs.
 *
 * The thin `scenarios` shell (engine=ROLEPLAY_V2, status DRAFT) is created AT
 * SPEC CREATION so `scenarioId` always exists; publish validates the chosen
 * snapshot, applies the rehearsal gate (409 unless force), flips the shell
 * ACTIVE with the spec's title/competency, and copies roleplay_spec_tenants
 * into scenario_tenants so learner listing works unchanged.
 */
@Injectable()
export class RoleplaySpecService {
  private readonly logger = LoggerService.getInstance(RoleplaySpecService.name);

  constructor(
    private readonly specRepository: RoleplaySpecRepository,
    private readonly specVersionRepository: RoleplaySpecVersionRepository,
    private readonly specTenantRepository: RoleplaySpecTenantRepository,
    private readonly rehearsalRunRepository: RehearsalRunRepository,
    private readonly specValidator: SpecValidatorService,
    private readonly permissionsService: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- specs

  async createSpec(
    dto: CreateRoleplaySpecDto,
    userId: number,
  ): Promise<RoleplaySpec> {
    const draftSpec: Partial<RoleplaySpecDocument> = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      title: dto.title,
      ...(dto.competencyId ? { competencyId: dto.competencyId } : {}),
      ...(dto.spec ?? {}),
    };

    return this.dataSource.transaction(async (em) => {
      // 1. Thin scenarios shell — created DRAFT so scenarioId always exists
      // and learner surfaces ignore it until first publish flips it ACTIVE.
      const scenarioRepo = em.getRepository(Scenarios);
      const scenario = await scenarioRepo.save(
        scenarioRepo.create({
          title: dto.title,
          status: ScenarioStatus.DRAFT,
          engine: ScenarioEngine.ROLEPLAY_V2,
          competencyId: dto.competencyId,
          isGlobal: false,
          isPublic: false,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      // 2. The spec itself.
      const specRepo = em.getRepository(RoleplaySpec);
      const spec = await specRepo.save(
        specRepo.create({
          title: dto.title,
          status: RoleplaySpecStatus.DRAFT,
          competencyId: dto.competencyId ?? null,
          scenarioId: scenario.id,
          draftSpec,
          createdBy: userId,
          updatedBy: userId,
        }),
      );

      // 3. Back-link the shell to the spec.
      await scenarioRepo.update(scenario.id, { roleplaySpecId: spec.id });
      return spec;
    });
  }

  async listSpecs(
    query: ListRoleplaySpecsQueryDto,
    userId: number,
  ): Promise<{ data: RoleplaySpec[]; count: number }> {
    const statuses = query.statuses
      ?.split(',')
      .map((status) => status.trim())
      .filter((status) => status.length > 0);
    const invalid = (statuses ?? []).filter(
      (status) =>
        !Object.values(RoleplaySpecStatus).includes(
          status as RoleplaySpecStatus,
        ),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid status values: ${invalid.join(', ')}`,
      );
    }

    // Multi-tenant admins only see their own specs (same scoping rule as the
    // v1 studio applies to scenarios/reports).
    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    const [data, count] = await this.specRepository.findAndCountSpecs({
      createdBy: isMultiTenantAdmin ? userId : undefined,
      statuses,
      limit: query.limit,
      offset: query.offset,
    });
    return { data, count };
  }

  async getSpec(specId: string): Promise<RoleplaySpec> {
    const spec = await this.specRepository.findOne({ where: { id: specId } });
    if (!spec) {
      throw new NotFoundException('Roleplay spec not found');
    }
    return spec;
  }

  /**
   * Detail envelope for the studio workspace. `activeVersion` is the working
   * draft the studio edits: its document is the spec row's `draftSpec`, its id
   * is the latest immutable snapshot (null until the first draft save — the
   * client tolerates that and picks the id up from its first save response).
   */
  async getSpecDetail(
    specId: string,
  ): Promise<RoleplaySpec & { activeVersion: Record<string, any> }> {
    const spec = await this.getSpec(specId);
    const [latestVersion] = await this.specVersionRepository.listBySpec(
      specId,
      1,
    );
    return {
      ...spec,
      activeVersion: {
        id: latestVersion?.id ?? null,
        versionNumber: latestVersion?.versionNumber ?? null,
        status: spec.status,
        spec: spec.draftSpec,
        updatedAt: spec.updatedAt,
      },
    };
  }

  async updateSpec(
    specId: string,
    dto: UpdateRoleplaySpecDto,
    userId: number,
  ): Promise<RoleplaySpec> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);

    if (dto.title !== undefined) {
      spec.title = dto.title;
      spec.draftSpec = { ...spec.draftSpec, title: dto.title };
    }
    if (dto.competencyId !== undefined) {
      spec.competencyId = dto.competencyId;
      spec.draftSpec = {
        ...spec.draftSpec,
        competencyId: dto.competencyId ?? undefined,
      };
    }
    spec.updatedBy = userId;
    return this.specRepository.save(spec);
  }

  async deleteSpec(specId: string, userId: number): Promise<SuccessResponse> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);

    await this.dataSource.transaction(async (em) => {
      await em.getRepository(RoleplaySpec).softDelete(specId);
      await em.getRepository(RoleplaySpecVersion).softDelete({ specId });
      await em.getRepository(RoleplaySpecTenant).softDelete({ specId });
      // Retire the shell scenario so learner listings drop it too.
      await em.getRepository(Scenarios).softDelete({
        id: spec.scenarioId,
        engine: ScenarioEngine.ROLEPLAY_V2,
      });
    });
    return { success: true };
  }

  // ---------------------------------------------------------------- draft

  /**
   * Optimistic-concurrency draft save: `expectedUpdatedAt` must equal the
   * spec row's current updatedAt or the write is rejected with 409 (another
   * writer — trainer tab or copilot patch — got there first).
   */
  async updateDraft(
    specId: string,
    dto: UpdateRoleplaySpecDraftDto,
    userId: number,
  ): Promise<{
    spec: RoleplaySpec;
    specVersionId: string;
    validation: SpecValidationResult;
  }> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);

    const expected = new Date(dto.expectedUpdatedAt).getTime();
    if (!Number.isFinite(expected) || expected !== spec.updatedAt.getTime()) {
      throw new ConflictException(
        'Draft was modified by someone else (expectedUpdatedAt mismatch). Reload and retry.',
      );
    }

    // Drafts may be work-in-progress: report validation, never block the save.
    const validation = await this.specValidator.validate(dto.spec, {
      checkDb: false,
    });

    const { spec: saved, version } = await this.persistDraftMutation(
      spec,
      dto.spec,
      userId,
      RoleplaySpecVersionSource.MANUAL_EDIT,
    );
    return { spec: saved, specVersionId: version.id, validation };
  }

  /**
   * Shared draft-mutation primitive (manual PUT + copilot update_spec):
   * writes draftSpec and appends an immutable roleplay_spec_versions snapshot
   * in one transaction. Retries once on a versionNumber race.
   */
  async persistDraftMutation(
    spec: RoleplaySpec,
    nextDraft: Partial<RoleplaySpecDocument>,
    userId: number,
    source: RoleplaySpecVersionSource,
    patchId?: string,
  ): Promise<{ spec: RoleplaySpec; version: RoleplaySpecVersion }> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction(async (em) => {
          const specRepo = em.getRepository(RoleplaySpec);

          const version = await this.insertVersionSnapshot(
            em,
            spec.id,
            nextDraft,
            userId,
            source,
            patchId,
          );

          await specRepo.update(spec.id, {
            draftSpec: nextDraft,
            title:
              typeof nextDraft.title === 'string' && nextDraft.title.trim()
                ? nextDraft.title
                : spec.title,
            competencyId: nextDraft.competencyId ?? spec.competencyId ?? null,
            updatedBy: userId,
          });
          const saved = await specRepo.findOneOrFail({
            where: { id: spec.id },
          });
          return { spec: saved, version };
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
   * Versions-only sibling of persistDraftMutation for the auto-improve loop:
   * appends an immutable snapshot WITHOUT touching roleplay_specs.draftSpec —
   * the trainer's working draft stays theirs until they accept the result.
   */
  async appendVersionSnapshot(
    specId: string,
    specDocument: Partial<RoleplaySpecDocument>,
    userId: number,
    source: RoleplaySpecVersionSource,
  ): Promise<RoleplaySpecVersion> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction((em) =>
          this.insertVersionSnapshot(em, specId, specDocument, userId, source),
        );
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isDuplicateKeyException(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** Shared version-row insert (inside the caller's transaction). */
  private async insertVersionSnapshot(
    em: EntityManager,
    specId: string,
    specDocument: Partial<RoleplaySpecDocument>,
    userId: number,
    source: RoleplaySpecVersionSource,
    patchId?: string,
  ): Promise<RoleplaySpecVersion> {
    const versionRepo = em.getRepository(RoleplaySpecVersion);
    const versionNumber = await this.specVersionRepository.getNextVersionNumber(
      specId,
      em,
    );
    return versionRepo.save(
      versionRepo.create({
        specId,
        versionNumber,
        spec: specDocument,
        status: RoleplaySpecVersionStatus.DRAFT,
        source,
        patchId: patchId ?? null,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  // -------------------------------------------------------------- versions

  async listVersions(
    specId: string,
    limit?: number,
  ): Promise<RoleplaySpecVersion[]> {
    await this.getSpec(specId);
    return this.specVersionRepository.listBySpec(specId, limit);
  }

  async getVersion(
    specId: string,
    versionId: string,
  ): Promise<RoleplaySpecVersion> {
    const version = await this.specVersionRepository.findOne({
      where: { id: versionId, specId },
    });
    if (!version) {
      throw new NotFoundException('Roleplay spec version not found');
    }
    return version;
  }

  /** Resolve a version by bare id (spec-fetch webhook / dispatch path). */
  async getVersionById(versionId: string): Promise<RoleplaySpecVersion> {
    const version = await this.specVersionRepository.findOne({
      where: { id: versionId },
    });
    if (!version) {
      throw new NotFoundException('Roleplay spec version not found');
    }
    return version;
  }

  /** Explicit checkpoint of the current draft. */
  async createVersion(
    specId: string,
    _dto: CreateRoleplaySpecVersionDto,
    userId: number,
  ): Promise<RoleplaySpecVersion> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);
    const { version } = await this.persistDraftMutation(
      spec,
      spec.draftSpec,
      userId,
      RoleplaySpecVersionSource.SNAPSHOT,
    );
    return version;
  }

  /**
   * Publish a snapshot:
   *  1. full validation (structure + catalogs) → 422 with the error list;
   *  2. rehearsal gate — a COMPLETED rehearsal run for THIS version is
   *     required unless `force` → 409;
   *  3. one transaction: archive the previously published version, flip this
   *     one PUBLISHED, point the spec at it, materialise the thin scenario
   *     (title/competency/status ACTIVE) and copy spec tenants →
   *     scenario_tenants.
   */
  async publishVersion(
    specId: string,
    versionId: string,
    userId: number,
    force = false,
  ): Promise<RoleplaySpecVersion> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);
    const version = await this.getVersion(specId, versionId);

    const validation = await this.specValidator.validate(version.spec);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        message: 'Spec version failed validation',
        errors: validation.errors,
      });
    }

    if (!force) {
      const completedRehearsal = await this.rehearsalRunRepository.findOne({
        where: {
          specVersionId: versionId,
          status: RehearsalStatus.COMPLETED,
        },
      });
      if (!completedRehearsal) {
        throw new ConflictException(
          'No completed rehearsal for this version. Run a rehearsal first, or publish with force=true.',
        );
      }
    }

    return this.dataSource.transaction(async (em) => {
      const versionRepo = em.getRepository(RoleplaySpecVersion);
      const specRepo = em.getRepository(RoleplaySpec);

      await versionRepo.update(
        { specId, status: RoleplaySpecVersionStatus.PUBLISHED },
        { status: RoleplaySpecVersionStatus.ARCHIVED, updatedBy: userId },
      );
      await versionRepo.update(version.id, {
        status: RoleplaySpecVersionStatus.PUBLISHED,
        publishedAt: new Date(),
        updatedBy: userId,
      });
      await specRepo.update(spec.id, {
        status: RoleplaySpecStatus.PUBLISHED,
        publishedVersionId: version.id,
        title: version.spec.title ?? spec.title,
        competencyId: version.spec.competencyId ?? spec.competencyId ?? null,
        updatedBy: userId,
      });

      await this.materializeScenario(em, spec, version, userId);
      await this.syncScenarioTenants(em, spec);

      return versionRepo.findOneOrFail({ where: { id: version.id } });
    });
  }

  /** Flip the thin scenarios shell live with the published snapshot's facts. */
  private async materializeScenario(
    em: EntityManager,
    spec: RoleplaySpec,
    version: RoleplaySpecVersion,
    userId: number,
  ): Promise<void> {
    const scenarioRepo = em.getRepository(Scenarios);
    const scenario = await scenarioRepo.findOne({
      where: { id: spec.scenarioId },
    });
    if (!scenario) {
      throw new NotFoundException(
        `Shell scenario ${spec.scenarioId} for spec ${spec.id} not found`,
      );
    }
    const doc = version.spec;
    await scenarioRepo.update(scenario.id, {
      title: doc.title ?? spec.title,
      description: doc.persona?.scenarioContext ?? scenario.description,
      status: ScenarioStatus.ACTIVE,
      competencyId: doc.competencyId ?? spec.competencyId ?? undefined,
      difficultyLevel:
        (doc.difficulty as Scenarios['difficultyLevel']) ??
        scenario.difficultyLevel,
      engine: ScenarioEngine.ROLEPLAY_V2,
      roleplaySpecId: spec.id,
      updatedBy: userId,
    });
  }

  /** Copy roleplay_spec_tenants → scenario_tenants (idempotent). */
  private async syncScenarioTenants(
    em: EntityManager,
    spec: RoleplaySpec,
  ): Promise<void> {
    const specTenants = await em
      .getRepository(RoleplaySpecTenant)
      .find({ where: { specId: spec.id } });
    if (specTenants.length === 0) return;

    const scenarioTenantRepo = em.getRepository(ScenarioTenants);
    const existing = await scenarioTenantRepo.find({
      where: {
        scenarioId: spec.scenarioId,
        tenantId: In(specTenants.map((tenant) => tenant.tenantId)),
      },
    });
    const existingTenantIds = new Set(existing.map((row) => row.tenantId));
    const missing = specTenants.filter(
      (tenant) => !existingTenantIds.has(tenant.tenantId),
    );
    if (missing.length > 0) {
      await scenarioTenantRepo.save(
        missing.map((tenant) =>
          scenarioTenantRepo.create({
            scenarioId: spec.scenarioId,
            tenantId: tenant.tenantId,
          }),
        ),
      );
    }
  }

  /** Validate the current draft (or a version) on demand for the studio UI. */
  async validateVersion(
    specId: string,
    versionId?: string,
  ): Promise<SpecValidationResult> {
    const spec = await this.getSpec(specId);
    const document = versionId
      ? (await this.getVersion(specId, versionId)).spec
      : spec.draftSpec;
    return this.specValidator.validate(document);
  }

  // --------------------------------------------------------------- tenants

  async listTenants(specId: string): Promise<RoleplaySpecTenant[]> {
    await this.getSpec(specId);
    return this.specTenantRepository.listBySpec(specId);
  }

  async shareWithTenants(
    specId: string,
    tenantIds: string[],
    userId: number,
  ): Promise<RoleplaySpecTenant[]> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(RoleplaySpecTenant);
      const existing = await repo.find({
        where: { specId, tenantId: In(tenantIds) },
      });
      const existingIds = new Set(existing.map((row) => row.tenantId));
      const toInsert = [...new Set(tenantIds)].filter(
        (tenantId) => !existingIds.has(tenantId),
      );
      if (toInsert.length > 0) {
        await repo.save(
          toInsert.map((tenantId) => repo.create({ specId, tenantId })),
        );
      }
      // Published specs mirror shares straight onto the live shell scenario.
      if (spec.status === RoleplaySpecStatus.PUBLISHED) {
        await this.syncScenarioTenants(em, spec);
      }
    });
    return this.specTenantRepository.listBySpec(specId);
  }

  async unshareTenant(
    specId: string,
    tenantId: string,
    userId: number,
  ): Promise<SuccessResponse> {
    const spec = await this.getSpec(specId);
    await this.assertOwnership(spec, userId);

    await this.dataSource.transaction(async (em) => {
      await em
        .getRepository(RoleplaySpecTenant)
        .softDelete({ specId, tenantId });
      await em
        .getRepository(ScenarioTenants)
        .softDelete({ scenarioId: spec.scenarioId, tenantId });
    });
    return { success: true };
  }

  // ----------------------------------------------------------------- misc

  private async assertOwnership(
    spec: RoleplaySpec,
    userId: number,
  ): Promise<void> {
    const isMultiTenantAdmin =
      await this.permissionsService.isMultiTenantAdmin(userId);
    if (isMultiTenantAdmin && spec.createdBy !== userId) {
      throw new ForbiddenException('You can only edit your own roleplay specs');
    }
  }

  /** Stable id source for copilot patches (kept here for reuse/tests). */
  newPatchId(): string {
    return uuidv4();
  }
}
