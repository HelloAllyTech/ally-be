import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Chat } from '../../chat/entity/chat.entity';
import {
  CustomFieldDefinition,
  CustomFieldEditPermission,
  CustomFieldFillMode,
  CustomFieldScope,
  CustomFieldType,
} from '../entity/custom-field-definition.entity';
import { ChatCustomFieldValue } from '../entity/chat-custom-field-value.entity';
import {
  CreateCustomFieldDefinitionDto,
  ReorderCustomFieldDefinitionsDto,
  UpdateCustomFieldDefinitionDto,
} from '../dto/custom-field-definition.dto';
import {
  CustomFieldValueResponseDto,
  UpsertCustomFieldValuesDto,
} from '../dto/custom-field-value.dto';
import { SUMMARY_SECTIONS } from '../../settings/constants/summary-sections.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { PermissionValidator } from '../../authorization/service/permission-validator.service';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { DEFAULT_FIELD_TEMPLATES } from '../constants/default-field-templates.constants';

const SESSION_LOG_COLUMN_LABELS = [
  'Call ID',
  'Counsellor',
  'Date & Time',
  'Duration',
  'Mode',
  'Tags',
  'Status',
  'Channel',
  'Actions',
  'Summary',
];

const BUILT_IN_FIELD_LABELS_LOWER = new Set([
  ...SUMMARY_SECTIONS.flatMap((s) =>
    s.fields.map((f) => f.label.toLowerCase()),
  ),
  ...SESSION_LOG_COLUMN_LABELS.map((l) => l.toLowerCase()),
]);

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    @InjectRepository(Chat)
    private readonly chatRepo: Repository<Chat>,
    @InjectRepository(CustomFieldDefinition)
    private readonly definitionRepo: Repository<CustomFieldDefinition>,
    @InjectRepository(ChatCustomFieldValue)
    private readonly valueRepo: Repository<ChatCustomFieldValue>,
    private readonly permissionValidator: PermissionValidator,
  ) {}

  private resolveTenantId(override?: string): string {
    const tenantId = override ?? ExecutionManager.getTenantId();
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    return tenantId;
  }

  private async resolveTenantIdWithSystemCheck(
    override?: string,
  ): Promise<string> {
    if (override) {
      const userId = ExecutionManager.getUserId();
      if (!userId) throw new BadRequestException('User ID is required');
      const hasSystemAccess =
        await this.permissionValidator.validatePermissions(parseInt(userId), [
          PERMISSIONS.SYSTEM_ACCESS,
        ]);
      if (!hasSystemAccess) {
        throw new ForbiddenException(
          'You do not have permission to access another tenant',
        );
      }
      return override;
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    return tenantId;
  }

  async getDefinitions(overrideTenantId?: string) {
    const tenantId =
      await this.resolveTenantIdWithSystemCheck(overrideTenantId);

    // Scribe settings (super admin path; identified by overrideTenantId) sees
    // only SUPER_ADMIN-scoped fields — those are what they manage there.
    // The in-app path returns BOTH scopes: counsellors and admins need to see
    // every field on the calls table and call-detail page so that values for
    // super-admin-managed fields render too. The frontend hides SUPER_ADMIN
    // entries from the in-app "Manage custom fields" dialog itself.
    const where: Record<string, unknown> = { tenantId, isActive: true };
    if (overrideTenantId) {
      where.scope = CustomFieldScope.SUPER_ADMIN;
    }
    return this.definitionRepo.find({
      where,
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getAiDefinitions(tenantId: string): Promise<CustomFieldDefinition[]> {
    return this.definitionRepo.find({
      where: { tenantId, isActive: true, fillMode: CustomFieldFillMode.AI },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createDefinition(dto: CreateCustomFieldDefinitionDto) {
    const { tenantId: dtoTenantId, ...fieldDto } = dto;
    const tenantId = await this.resolveTenantIdWithSystemCheck(dtoTenantId);
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    if (BUILT_IN_FIELD_LABELS_LOWER.has(fieldDto.name.toLowerCase())) {
      throw new BadRequestException(
        `"${fieldDto.name}" is a built-in field name and cannot be used for a custom field`,
      );
    }

    const duplicate = await this.definitionRepo
      .createQueryBuilder('d')
      .where('d.tenantId = :tenantId', { tenantId })
      .andWhere('LOWER(d.name) = LOWER(:name)', { name: fieldDto.name })
      .andWhere('d.isActive = true')
      .getOne();
    if (duplicate) {
      throw new BadRequestException(
        `A custom field named "${fieldDto.name}" already exists`,
      );
    }

    if (
      (fieldDto.fieldType === CustomFieldType.SINGLE_SELECT ||
        fieldDto.fieldType === CustomFieldType.MULTI_SELECT) &&
      (!fieldDto.options || fieldDto.options.length === 0)
    ) {
      throw new BadRequestException(
        'At least one option is required for Single Select and Multi Select fields',
      );
    }

    const definition = this.definitionRepo.create({
      ...fieldDto,
      options:
        fieldDto.fieldType === CustomFieldType.SINGLE_SELECT ||
        fieldDto.fieldType === CustomFieldType.MULTI_SELECT
          ? fieldDto.options
          : undefined,
      displayOrder: fieldDto.displayOrder ?? 0,
      // An explicit dtoTenantId means the caller went through the super-admin
      // override path (validated above) — that's the scribe-settings flow.
      // Without it we're on the in-app tenant-scoped flow.
      scope: dtoTenantId
        ? CustomFieldScope.SUPER_ADMIN
        : CustomFieldScope.ORG_ADMIN,
      tenantId,
      createdBy: parseInt(userId),
      updatedBy: parseInt(userId),
    });

    return this.definitionRepo.save(definition);
  }

  async reorderDefinitions(dto: ReorderCustomFieldDefinitionsDto) {
    const tenantId = ExecutionManager.getTenantId();
    const userId = ExecutionManager.getUserId();
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (!userId) throw new BadRequestException('User ID is required');

    const definitions = await this.definitionRepo.find({
      where: { tenantId, isActive: true },
    });
    const definitionMap = new Map(definitions.map((d) => [d.id, d]));

    for (const id of dto.ids) {
      if (!definitionMap.has(id)) {
        throw new BadRequestException(`Custom field ${id} not found`);
      }
    }

    const toSave = dto.ids.map((id, i) => {
      const definition = definitionMap.get(id)!;
      definition.displayOrder = i;
      definition.updatedBy = parseInt(userId);
      return definition;
    });

    await this.definitionRepo.save(toSave);
    return { success: true };
  }

  async updateDefinition(id: string, dto: UpdateCustomFieldDefinitionDto) {
    const { tenantId: dtoTenantId, ...fieldDto } = dto;
    const tenantId = await this.resolveTenantIdWithSystemCheck(dtoTenantId);
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const definition = await this.definitionRepo.findOne({
      where: { id, tenantId },
    });
    if (!definition) throw new NotFoundException('Custom field not found');

    this.assertScopeMatchesPath(definition, dtoTenantId);

    if (
      fieldDto.name &&
      fieldDto.name.toLowerCase() !== definition.name.toLowerCase()
    ) {
      if (BUILT_IN_FIELD_LABELS_LOWER.has(fieldDto.name.toLowerCase())) {
        throw new BadRequestException(
          `"${fieldDto.name}" is a built-in field name and cannot be used for a custom field`,
        );
      }

      const duplicate = await this.definitionRepo
        .createQueryBuilder('d')
        .where('d.tenantId = :tenantId', { tenantId })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name: fieldDto.name })
        .andWhere('d.isActive = true')
        .getOne();
      if (duplicate) {
        throw new BadRequestException(
          `A custom field named "${fieldDto.name}" already exists`,
        );
      }
    }

    Object.assign(definition, {
      ...fieldDto,
      updatedBy: parseInt(userId),
    });

    return this.definitionRepo.save(definition);
  }

  /**
   * Reject cross-scope writes: a SUPER_ADMIN definition can only be edited
   * via the super-admin path (caller supplies an overrideTenantId), and an
   * ORG_ADMIN definition only via the in-app path (no overrideTenantId).
   */
  private assertScopeMatchesPath(
    definition: CustomFieldDefinition,
    overrideTenantId: string | undefined,
  ): void {
    const callerScope = overrideTenantId
      ? CustomFieldScope.SUPER_ADMIN
      : CustomFieldScope.ORG_ADMIN;
    if (definition.scope !== callerScope) {
      throw new ForbiddenException(
        definition.scope === CustomFieldScope.SUPER_ADMIN
          ? 'This custom field is managed by the super admin in scribe settings'
          : 'This custom field is managed in the organization settings',
      );
    }
  }

  async deleteDefinition(id: string, overrideTenantId?: string) {
    const tenantId =
      await this.resolveTenantIdWithSystemCheck(overrideTenantId);
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const definition = await this.definitionRepo.findOne({
      where: { id, tenantId },
    });
    if (!definition) throw new NotFoundException('Custom field not found');

    this.assertScopeMatchesPath(definition, overrideTenantId);

    definition.isActive = false;
    definition.updatedBy = parseInt(userId);
    await this.definitionRepo.save(definition);

    return { success: true };
  }

  async getValues(chatId: number): Promise<CustomFieldValueResponseDto[]> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const sectionLabelMap = new Map(
      SUMMARY_SECTIONS.map((s) => [s.id, s.label]),
    );

    const [definitions, values] = await Promise.all([
      this.definitionRepo.find({
        where: { tenantId, isActive: true },
        order: { displayOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.valueRepo.find({
        where: { tenantId, chatId },
      }),
    ]);

    const valueMap = new Map(values.map((v) => [v.fieldDefinitionId, v.value]));

    return definitions.map(
      (def): CustomFieldValueResponseDto => ({
        fieldDefinitionId: def.id,
        name: def.name,
        fieldType: def.fieldType,
        options: def.options,
        sectionKey: def.sectionKey,
        sectionLabel: sectionLabelMap.get(def.sectionKey) ?? def.sectionKey,
        editPermission: def.editPermission,
        fillMode: def.fillMode,
        displayOrder: def.displayOrder,
        value: valueMap.get(def.id) ?? null,
      }),
    );
  }

  async upsertValues(chatId: number, dto: UpsertCustomFieldValuesDto) {
    const tenantId = ExecutionManager.getTenantId();
    const userId = ExecutionManager.getUserId();
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (!userId) throw new BadRequestException('User ID is required');

    const userIdInt = parseInt(userId);

    const [isAdmin, chat] = await Promise.all([
      this.permissionValidator.validatePermissions(userIdInt, [
        PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS,
      ]),
      this.chatRepo.findOne({ where: { id: chatId, tenantId } }),
    ]);

    if (!chat) {
      throw new NotFoundException(`Chat ${chatId} not found`);
    }

    const isCounsellorForCall = chat.counselorId === userIdInt;

    if (!isAdmin && !isCounsellorForCall) {
      throw new ForbiddenException(
        'You can only edit custom fields for calls you counsel',
      );
    }

    const definitionIds = dto.values.map((v) => v.fieldDefinitionId);
    const definitions = await this.definitionRepo
      .createQueryBuilder('d')
      .where('d.id IN (:...ids)', { ids: definitionIds })
      .andWhere('d.tenantId = :tenantId', { tenantId })
      .andWhere('d.isActive = true')
      .getMany();

    const definitionMap = new Map(definitions.map((d) => [d.id, d]));

    for (const entry of dto.values) {
      const def = definitionMap.get(entry.fieldDefinitionId);
      if (!def) {
        throw new BadRequestException(
          `Custom field ${entry.fieldDefinitionId} not found`,
        );
      }

      const canEdit =
        def.editPermission === CustomFieldEditPermission.BOTH ||
        (isAdmin &&
          def.editPermission === CustomFieldEditPermission.ADMIN_ONLY) ||
        (isCounsellorForCall &&
          def.editPermission === CustomFieldEditPermission.COUNSELLOR_ONLY);

      if (!canEdit) {
        throw new ForbiddenException(
          `You do not have permission to edit field "${def.name}"`,
        );
      }
    }

    const existing = await this.valueRepo.find({
      where: { tenantId, chatId },
    });
    const existingMap = new Map(existing.map((v) => [v.fieldDefinitionId, v]));

    const toSave = dto.values.map((entry) => {
      const record =
        existingMap.get(entry.fieldDefinitionId) ??
        this.valueRepo.create({
          chatId,
          fieldDefinitionId: entry.fieldDefinitionId,
          tenantId,
        });
      record.value = entry.value;
      record.updatedBy = userIdInt;
      return record;
    });

    await this.valueRepo.save(toSave);
    return { success: true };
  }

  async upsertValuesInternal(
    chatId: number,
    tenantId: string,
    values: Array<{ fieldDefinitionId: string; value: string }>,
  ): Promise<void> {
    if (values.length === 0) return;

    const definitionIds = values.map((v) => v.fieldDefinitionId);
    const validDefinitions = await this.definitionRepo
      .createQueryBuilder('d')
      .where('d.id IN (:...ids)', { ids: definitionIds })
      .andWhere('d.tenantId = :tenantId', { tenantId })
      .andWhere('d.isActive = true')
      .getMany();

    const validIds = new Set(validDefinitions.map((d) => d.id));
    const safeValues = values.filter((v) => validIds.has(v.fieldDefinitionId));

    if (safeValues.length === 0) return;

    const existing = await this.valueRepo.find({
      where: { tenantId, chatId },
    });
    const existingIds = new Set(existing.map((v) => v.fieldDefinitionId));

    // Insert-only: an AI-fill run (initial generation, retry, or a duplicate
    // delivery race) must never overwrite a value that's already set —
    // whether an earlier AI pass set it or a human edited it since. Once a
    // field has a value, only an explicit human edit (upsertValues) changes
    // it from here on.
    const toCreate = safeValues
      .filter((entry) => !existingIds.has(entry.fieldDefinitionId))
      .map((entry) =>
        this.valueRepo.create({
          chatId,
          fieldDefinitionId: entry.fieldDefinitionId,
          tenantId,
          value: entry.value,
          updatedBy: 0,
        }),
      );

    if (toCreate.length === 0) return;

    await this.valueRepo.save(toCreate);
  }

  /**
   * Creates one CustomFieldDefinition per DEFAULT_FIELD_TEMPLATES entry for a
   * tenant that doesn't already have it. Idempotent — matches on `seedKey`,
   * so re-running (e.g. a retried migration) never duplicates rows. Pass an
   * `entityManager` to run inside an existing transaction (e.g.
   * TenantService.create()'s provisioning transaction); otherwise runs
   * standalone.
   */
  async seedDefaultDefinitionsForTenant(
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<void> {
    const definitionRepo = entityManager
      ? entityManager.getRepository(CustomFieldDefinition)
      : this.definitionRepo;

    const existingDefinitions = await definitionRepo.find({
      where: { tenantId },
    });
    const existingSeedKeys = new Set(
      existingDefinitions
        .map((d) => d.seedKey)
        .filter((key): key is string => !!key),
    );
    const existingActiveNamesLower = new Set(
      existingDefinitions
        .filter((d) => d.isActive)
        .map((d) => d.name.toLowerCase()),
    );

    const toCreate: CustomFieldDefinition[] = [];
    for (const template of DEFAULT_FIELD_TEMPLATES) {
      if (existingSeedKeys.has(template.seedKey)) continue;

      if (existingActiveNamesLower.has(template.name.toLowerCase())) {
        this.logger.warn(
          `Skipping seed of default field "${template.name}" (seedKey: ${template.seedKey}) for tenant ${tenantId}: a custom field with this name already exists`,
        );
        continue;
      }

      toCreate.push(
        definitionRepo.create({
          name: template.name,
          fieldType: template.fieldType,
          options: template.options,
          sectionKey: template.sectionKey,
          editPermission: CustomFieldEditPermission.BOTH,
          fillMode: template.fillMode,
          aiInstruction: template.aiInstruction,
          scope: CustomFieldScope.SUPER_ADMIN,
          displayOrder: template.displayOrder,
          showInTable: false,
          isActive: true,
          seedKey: template.seedKey,
          enhanceable: template.enhanceable,
          tenantId,
          createdBy: 0,
          updatedBy: 0,
        }),
      );
    }

    if (toCreate.length === 0) return;

    await definitionRepo.save(toCreate);
  }
}
