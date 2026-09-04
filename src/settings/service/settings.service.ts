import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CommonUtil } from '../../common/util/common.util';
import {
  DEFAULT_SUMMARY_FIELDS_ARRAY,
  DEFAULT_SUMMARY_FIELDS_SET,
} from '../constants/settings.constants';
import { PreferenceService } from './preference.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from '../../common/constants/user.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import {
  CustomFieldsEnabledPreferenceValue,
  HiddenSectionsPreferenceValue,
  SummaryPreferenceValue,
} from '../../common/type/common.type';
import {
  DEFAULT_CHAT_TYPES,
  DEFAULT_TURN_ENDPOINTING_SETTINGS,
  LEGAL_CONTENT_NAMES,
  SELECTABLE_CHAT_TYPES,
  TURN_ENDPOINTING_SETTINGS_NAME,
} from '../constants/settings.constants';
import {
  TurnEndpointingSettings,
  UpdateTurnEndpointingSettingsDto,
} from '../dto/turn-endpointing-settings.dto';
import {
  DEFAULT_HIDDEN_SECTION_IDS,
  SECTION_ID_TO_FIELD_IDS,
  SUMMARY_SECTION_IDS,
  SUMMARY_SECTIONS,
} from '../constants/summary-sections.constants';
import { DataSource, EntityManager } from 'typeorm';
import * as _ from 'lodash';
import { GlobalSettingsRepository } from '../repository/global-settings.repository';
import { sanitizeDescriptionHtml } from '../../common/util/sanitize-html.util';
import { ChatTypes } from '../../common/constants/chat.constants';
import {
  GetSummaryFieldsDto,
  UpdateSummaryFieldsDto,
} from '../dto/summary-fields.dto';
import { UpdateSummarySectionsDto } from '../dto/summary-sections.dto';
import { GetChatTypesDto, UpdateChatTypesDto } from '../dto/chat-types.dto';
import { AuditLogService } from 'src/audit/service/audit-log.service';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { AdminTenantService } from 'src/user/service/admin-tenant.service';
import { CustomFieldType } from '../../custom-fields/entity/custom-field-definition.entity';
import {
  AUDIT_ACTIONS,
  AUDIT_EVENTS,
} from 'src/audit/constants/audit-event.constants';

@Injectable()
export class SettingsService {
  constructor(
    private readonly preferenceService: PreferenceService,
    private readonly permissionValidator: PermissionValidator,
    private readonly auditLogService: AuditLogService,
    private permissionsService: PermissionsService,
    private readonly adminTenantService: AdminTenantService,
    private readonly dataSource: DataSource,
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /**
   * Read editable legal page content (Terms / Privacy) stored as a
   * global_settings row. Returns an empty string if it hasn't been set yet.
   */
  async getLegalContent(
    name: (typeof LEGAL_CONTENT_NAMES)[keyof typeof LEGAL_CONTENT_NAMES],
  ): Promise<{ html: string }> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name },
    });
    const html = (row?.value as { html?: string } | undefined)?.html ?? '';
    return { html };
  }

  /**
   * Upsert editable legal page content. Sanitizes the incoming HTML before
   * persisting. Access is gated to super admins at the controller layer.
   */
  async updateLegalContent(
    name: (typeof LEGAL_CONTENT_NAMES)[keyof typeof LEGAL_CONTENT_NAMES],
    html: string,
  ): Promise<{ success: boolean }> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const sanitized = sanitizeDescriptionHtml(html ?? '');
    const existing = await this.globalSettingsRepository.findOne({
      where: { name },
    });
    if (existing) {
      existing.value = { html: sanitized };
      existing.updatedBy = parseInt(userId);
      await this.globalSettingsRepository.save(existing);
    } else {
      const entity = this.globalSettingsRepository.create({
        name,
        value: { html: sanitized },
        createdBy: parseInt(userId),
        updatedBy: parseInt(userId),
      });
      await this.globalSettingsRepository.save(entity);
    }
    return { success: true };
  }

  /**
   * Read the global turn-endpointing bounds (seconds) used by Studio v1
   * roleplay sessions, stored as a global_settings row. Falls back to
   * LiveKit's own defaults if no admin has saved a value yet — the setting
   * must always resolve to a well-defined pair.
   */
  async getTurnEndpointingSettings(): Promise<TurnEndpointingSettings> {
    const row = await this.globalSettingsRepository.findOne({
      where: { name: TURN_ENDPOINTING_SETTINGS_NAME },
    });
    const value = row?.value as Partial<TurnEndpointingSettings> | undefined;
    return {
      turnMinEndpointingDelay:
        value?.turnMinEndpointingDelay ??
        DEFAULT_TURN_ENDPOINTING_SETTINGS.turnMinEndpointingDelay,
      turnMaxEndpointingDelay:
        value?.turnMaxEndpointingDelay ??
        DEFAULT_TURN_ENDPOINTING_SETTINGS.turnMaxEndpointingDelay,
    };
  }

  /**
   * Upsert the global turn-endpointing bounds. Access is gated to super
   * admins at the controller layer.
   */
  async updateTurnEndpointingSettings(
    dto: UpdateTurnEndpointingSettingsDto,
  ): Promise<{ success: boolean }> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const value: TurnEndpointingSettings = {
      turnMinEndpointingDelay: dto.turnMinEndpointingDelay,
      turnMaxEndpointingDelay: dto.turnMaxEndpointingDelay,
    };
    const existing = await this.globalSettingsRepository.findOne({
      where: { name: TURN_ENDPOINTING_SETTINGS_NAME },
    });
    if (existing) {
      existing.value = value;
      existing.updatedBy = parseInt(userId);
      await this.globalSettingsRepository.save(existing);
    } else {
      const entity = this.globalSettingsRepository.create({
        name: TURN_ENDPOINTING_SETTINGS_NAME,
        value,
        createdBy: parseInt(userId),
        updatedBy: parseInt(userId),
      });
      await this.globalSettingsRepository.save(entity);
    }
    return { success: true };
  }

  private async resolveTenantCode(tenantId: string): Promise<string> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tenantId,
      );
    if (!isUuid) return tenantId;
    const row = await this.dataSource.query(
      `SELECT code FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return row?.[0]?.code ?? tenantId;
  }

  /**
   * Which tenant a settings WRITE lands on.
   *
   * A tenant admin is pinned to their own tenant; an Ally staff account
   * (SYSTEM_ACCESS) may name any tenant, which is what the admin dashboard's
   * per-tenant screens do. The `??` on the staff branch is the part that
   * matters: the helpline app's own Org. Settings screen sends no `tenantId`
   * at all — it is the *own*-tenant screen, so there is nothing to send — and
   * without the fallback a staff account opening that screen got
   * "Tenant ID is required" on every toggle while an ordinary tenant admin on
   * the same screen succeeded. The matching read helpers have always had this
   * fallback, so the getter reported one thing and the setter refused to
   * change it.
   *
   * Returns the resolved tenant CODE (see resolveTenantCode) — preference rows
   * are keyed by code, not by uuid.
   */
  private async resolveWritableTenantId(tenantId?: string): Promise<string> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const scopedTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!scopedTenantId) throw new BadRequestException('Tenant ID is required');
    return this.resolveTenantCode(scopedTenantId);
  }

  async getSummaryFieldsConfig(getSummaryFieldsDto?: GetSummaryFieldsDto) {
    const { tenantId: selectedTenantId } = getSummaryFieldsDto || {};
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const tenantId = hasSystemAccess
      ? selectedTenantId
      : ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const [hiddenOrgPreference, hiddenSectionsPreference] = await Promise.all([
      this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        tenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      ),
      this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        tenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      ),
    ]);

    let counselorPreference;
    if (!hasSystemAccess) {
      counselorPreference = await this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        userId,
        PreferenceRelatedEntity.COUNSELOR,
      );
    }

    const hiddenSectionIdsFromPreference = (
      hiddenSectionsPreference?.value as HiddenSectionsPreferenceValue
    )?.sections;
    const hiddenSectionIds =
      hiddenSectionIdsFromPreference !== undefined &&
      hiddenSectionIdsFromPreference !== null
        ? hiddenSectionIdsFromPreference
        : [...DEFAULT_HIDDEN_SECTION_IDS];

    const orgValue = hiddenOrgPreference?.value as
      | SummaryPreferenceValue
      | undefined;
    const orgHiddenFromPreference = orgValue?.fields || [];

    const fieldsFromHiddenSections = hiddenSectionIds.flatMap(
      (sectionId) => SECTION_ID_TO_FIELD_IDS[sectionId] ?? [],
    );

    const orgHiddenFields = [
      ...new Set([...orgHiddenFromPreference, ...fieldsFromHiddenSections]),
    ];

    const hiddenFields = [
      ...orgHiddenFields,
      ...((counselorPreference?.value as SummaryPreferenceValue)?.fields || []),
    ];
    const hiddenFieldsSet = new Set(hiddenFields);
    const visibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
      (field) => !hiddenFieldsSet.has(field),
    );
    return visibleFields;
  }

  async getSummarySectionsConfig(
    getSummaryFieldsDto?: GetSummaryFieldsDto,
  ): Promise<{
    sections: Array<{
      id: string;
      label: string;
      defaultVisibility: boolean;
      enabled: boolean;
      fields: Array<{ id: string; label: string; visible: boolean }>;
    }>;
  }> {
    const { tenantId: selectedTenantId } = getSummaryFieldsDto || {};
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const tenantId = hasSystemAccess
      ? selectedTenantId
      : ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const [hiddenOrgPreference, hiddenSectionsPreference] = await Promise.all([
      this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        tenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      ),
      this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        tenantId,
        PreferenceRelatedEntity.ORGANIZATION,
      ),
    ]);

    let counselorPreference;
    if (!hasSystemAccess) {
      counselorPreference = await this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        userId,
        PreferenceRelatedEntity.COUNSELOR,
      );
    }

    const hiddenSectionIdsFromPreference = (
      hiddenSectionsPreference?.value as HiddenSectionsPreferenceValue
    )?.sections;
    const hiddenSectionIds =
      hiddenSectionIdsFromPreference !== undefined &&
      hiddenSectionIdsFromPreference !== null
        ? hiddenSectionIdsFromPreference
        : [...DEFAULT_HIDDEN_SECTION_IDS];

    const orgValue = hiddenOrgPreference?.value as
      | SummaryPreferenceValue
      | undefined;
    const orgHiddenFromPreference = orgValue?.fields || [];
    const fieldsFromHiddenSections = hiddenSectionIds.flatMap(
      (sectionId) => SECTION_ID_TO_FIELD_IDS[sectionId] ?? [],
    );
    const orgHiddenFields = [
      ...new Set([...orgHiddenFromPreference, ...fieldsFromHiddenSections]),
    ];
    const hiddenFields = [
      ...orgHiddenFields,
      ...((counselorPreference?.value as SummaryPreferenceValue)?.fields || []),
    ];
    const hiddenFieldsSet = new Set(hiddenFields);

    const sections = SUMMARY_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      defaultVisibility: section.defaultVisibility,
      enabled: !hiddenSectionIds.includes(section.id),
      fields: section.fields.map((f) => ({
        id: f.id,
        label: f.label,
        visible:
          !hiddenSectionIds.includes(section.id) && !hiddenFieldsSet.has(f.id),
      })),
    }));

    return { sections };
  }

  async getHiddenSummaryFields() {
    const orgPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      ExecutionManager.getTenantId()!,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    const counselorPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      ExecutionManager.getUserId()!,
      PreferenceRelatedEntity.COUNSELOR,
    );
    const hiddenFields = [
      ...((orgPreference?.value as SummaryPreferenceValue)?.fields || []),
      ...((counselorPreference?.value as SummaryPreferenceValue)?.fields || []),
    ];
    return hiddenFields;
  }

  async updateSummaryFields(updateSummaryFieldsDto: UpdateSummaryFieldsDto) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const tenantId =
      hasSystemAccess && updateSummaryFieldsDto.tenantId != null
        ? updateSummaryFieldsDto.tenantId
        : ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { hiddenFields: summaryFields } = updateSummaryFieldsDto;

    const invalidKeys = CommonUtil.getInvalidKeysFromSet(
      DEFAULT_SUMMARY_FIELDS_SET,
      summaryFields,
    );
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `Invalid summary fields - ${invalidKeys.join(', ')}`,
      );
    }

    const relatedEntity = PreferenceRelatedEntity.ORGANIZATION;
    const relatedId = tenantId;
    const tenantIdForCreate = ExecutionManager.getTenantId();

    const existingPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      relatedId,
      relatedEntity,
    );
    if (existingPreference) {
      await this.preferenceService.updatePreference(existingPreference.id, {
        fields: summaryFields,
      });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
        relatedId,
        relatedEntity,
        value: { fields: summaryFields },
        tenantId: tenantIdForCreate,
      });
    }

    return { success: true };
  }

  async updateSummarySections(dto: UpdateSummarySectionsDto) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    // Super admins may target any tenant; a tenant admin is locked to their own.
    // The `??` matters — see resolveWritableTenantId: the helpline app's own
    // Org. Settings screen sends no tenantId, so without it a staff account on
    // that screen fails where a tenant admin succeeds.
    const scopedTenantId = hasSystemAccess
      ? (dto.tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!scopedTenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(parseInt(userId))
      : false;

    if (isMultiTenantAdmin) {
      const adminTenants = await this.adminTenantService.getTenantsForAdmin(
        Number(userId),
      );

      const adminTenantIds = adminTenants.data.map((t: any) => t.id);

      if (!adminTenantIds.includes(scopedTenantId)) {
        throw new ForbiddenException(
          'You are not authorized to update summary sections for this tenant',
        );
      }
    }

    const { hiddenSections } = dto;

    const invalidSectionIds = hiddenSections.filter(
      (id) => !SUMMARY_SECTION_IDS.includes(id),
    );
    if (invalidSectionIds.length > 0) {
      throw new BadRequestException(
        `Invalid section ids - ${invalidSectionIds.join(', ')}`,
      );
    }

    const relatedEntity = PreferenceRelatedEntity.ORGANIZATION;
    const relatedId = scopedTenantId;
    const tenantIdForCreate = ExecutionManager.getTenantId();

    const existing = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_SECTIONS,
      relatedId,
      relatedEntity,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, {
        sections: hiddenSections,
      });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.SUMMARY_HIDDEN_SECTIONS,
        relatedId,
        relatedEntity,
        value: { sections: hiddenSections },
        tenantId: tenantIdForCreate,
      });
    }

    if (isMultiTenantAdmin) {
      this.auditLogService.log({
        eventType:
          AUDIT_EVENTS.MULTI_TENANT_ADMIN_EDITED_SETTINGS_SUMMARY_FIELDS,
        details: {
          action: AUDIT_ACTIONS.UPDATE_SETTING_SUMMARY_FIELDS,
          tenantId: scopedTenantId,
          userId,
          hiddenSections,
        },
      });
    }
    return { success: true };
  }

  async getNudgeStatus() {
    const orgPreference = await this.preferenceService.getPreference(
      PreferenceName.NUDGE_STATUS,
      ExecutionManager.getTenantId()!,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    const counselorPreference = await this.preferenceService.getPreference(
      PreferenceName.NUDGE_STATUS,
      ExecutionManager.getUserId()!,
      PreferenceRelatedEntity.COUNSELOR,
    );
    const status =
      _.get(orgPreference, 'value.status') ??
      _.get(counselorPreference, 'value.status') ??
      true;
    return status;
  }

  async updateNudgeStatus(status: boolean) {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    // Check if user has admin permissions to manage organization settings
    const canManageOrgSettings =
      await this.permissionValidator.validatePermissions(parseInt(userId), [
        PERMISSIONS.ORGANIZATION_ACCESS,
      ]);

    const relatedId = canManageOrgSettings
      ? ExecutionManager.getTenantId()
      : userId;
    const relatedEntity = canManageOrgSettings
      ? PreferenceRelatedEntity.ORGANIZATION
      : PreferenceRelatedEntity.COUNSELOR;
    if (!relatedId || !relatedEntity) {
      throw new BadRequestException('Related ID or Entity is required');
    }
    const existingPreference = await this.preferenceService.getPreference(
      PreferenceName.NUDGE_STATUS,
      relatedId,
      relatedEntity,
    );
    if (existingPreference) {
      return await this.preferenceService.updatePreference(
        existingPreference.id,
        { status },
      );
    }
    return await this.preferenceService.createPreference({
      name: PreferenceName.NUDGE_STATUS,
      relatedId,
      relatedEntity,
      value: { status },
      tenantId: ExecutionManager.getTenantId(),
    });
  }

  async getChatTypes(getChatTypesDto?: GetChatTypesDto): Promise<string[]> {
    const { tenantId: selectedTenantId } = getChatTypesDto || {};

    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );

    const tenantId = hasSystemAccess
      ? selectedTenantId
      : ExecutionManager.getTenantId();

    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const hiddenChatTypes = await this.getHiddenChatTypesForEntity(
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    // SELECTABLE_CHAT_TYPES, not DEFAULT_CHAT_TYPES: retired types are never
    // advertised regardless of the tenant's preference. This is what stops
    // already-shipped web and mobile builds from offering dictation, since both
    // gate the Start Session buttons on this response.
    const visibleChatTypes = SELECTABLE_CHAT_TYPES.filter(
      (type) => !hiddenChatTypes.includes(type),
    );
    return visibleChatTypes;
  }

  async getHiddenChatTypesForEntity(
    relatedId: string,
    relatedEntity: string,
  ): Promise<string[]> {
    const preference = await this.preferenceService.getPreference(
      PreferenceName.HIDDEN_CHAT_TYPES,
      relatedId,
      relatedEntity,
    );

    if (!preference?.value) {
      return [];
    }

    const hiddenChatTypes = preference.value as string[];
    return Array.isArray(hiddenChatTypes) ? hiddenChatTypes : [];
  }

  async getEnabledCustomFieldTypes(tenantId?: string): Promise<string[]> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    const allTypes = Object.values(CustomFieldType);
    if (!preference?.value) {
      return allTypes;
    }
    const enabled = preference.value as string[];
    return Array.isArray(enabled) ? enabled : allTypes;
  }

  async getCustomFieldsEnabled(tenantId?: string): Promise<boolean> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.CUSTOM_FIELDS_ENABLED,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference?.value) return false;
    return (
      (preference.value as CustomFieldsEnabledPreferenceValue).enabled ?? false
    );
  }

  async updateCustomFieldsEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    const resolvedId = await this.resolveWritableTenantId(tenantId);
    const existing = await this.preferenceService.getPreference(
      PreferenceName.CUSTOM_FIELDS_ENABLED,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, { enabled });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.CUSTOM_FIELDS_ENABLED,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled },
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  /**
   * Org-level switch that lets a tenant's own ADMINs reach the Character
   * Library and its interview agent, scoped to characters they create. OFF
   * until a platform admin turns it on for that org — see
   * PreferenceName.CHARACTER_LIBRARY_ENABLED.
   */
  async getCharacterLibraryEnabled(tenantId?: string): Promise<boolean> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) return false;
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.CHARACTER_LIBRARY_ENABLED,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference?.value) return false;
    return (
      (preference.value as CustomFieldsEnabledPreferenceValue).enabled ?? false
    );
  }

  async updateCharacterLibraryEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    // Only a platform admin may grant this — a tenant admin must not be able to
    // switch on their own access. The `??` on the staff branch matters: the
    // helpline app's own Org Settings screen sends no tenantId at all.
    const scopedTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!scopedTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedId = await this.resolveTenantCode(scopedTenantId);

    const existing = await this.preferenceService.getPreference(
      PreferenceName.CHARACTER_LIBRARY_ENABLED,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, { enabled });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.CHARACTER_LIBRARY_ENABLED,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled },
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  /**
   * Org-level switch for the Learner Progress screen (XP/levels). OFF until a
   * platform admin turns it on for that org — see
   * PreferenceName.PROGRESS_DASHBOARD_ENABLED. Read the same way
   * TenantFeatureService.isEnabledForTenant does (same `preference` row), so a
   * flip here takes effect immediately for the guard as well.
   */
  async getProgressDashboardEnabled(tenantId?: string): Promise<boolean> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) return false;
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.PROGRESS_DASHBOARD_ENABLED,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference?.value) return false;
    return (
      (preference.value as CustomFieldsEnabledPreferenceValue).enabled ?? false
    );
  }

  async updateProgressDashboardEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');
    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    // Only a platform admin may grant this — a tenant admin must not be able to
    // switch it on for themselves. The `??` on the staff branch matters: the
    // helpline app's own Org Settings screen sends no tenantId at all.
    const scopedTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!scopedTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedId = await this.resolveTenantCode(scopedTenantId);

    const existing = await this.preferenceService.getPreference(
      PreferenceName.PROGRESS_DASHBOARD_ENABLED,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, { enabled });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.PROGRESS_DASHBOARD_ENABLED,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled },
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  async getScribeNoteCreationEnabled(tenantId?: string): Promise<boolean> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference?.value) return false;
    return (
      (preference.value as CustomFieldsEnabledPreferenceValue).enabled ?? false
    );
  }

  async updateScribeNoteCreationEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    const resolvedId = await this.resolveWritableTenantId(tenantId);
    const existing = await this.preferenceService.getPreference(
      PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, { enabled });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.SCRIBE_NOTE_CREATION_ENABLED,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled },
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  async getScribeVoiceNoteEnabled(tenantId?: string): Promise<boolean> {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('User ID is required');

    const hasSystemAccess = await this.permissionValidator.validatePermissions(
      parseInt(userId),
      [PERMISSIONS.SYSTEM_ACCESS],
    );
    const rawTenantId = hasSystemAccess
      ? (tenantId ?? ExecutionManager.getTenantId())
      : ExecutionManager.getTenantId();
    if (!rawTenantId) throw new BadRequestException('Tenant ID is required');
    const resolvedTenantId = await this.resolveTenantCode(rawTenantId);

    const preference = await this.preferenceService.getPreference(
      PreferenceName.SCRIBE_VOICE_NOTE_ENABLED,
      resolvedTenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference?.value) return false;
    return (
      (preference.value as CustomFieldsEnabledPreferenceValue).enabled ?? false
    );
  }

  async updateScribeVoiceNoteEnabled(
    tenantId: string,
    enabled: boolean,
  ): Promise<{ success: boolean }> {
    const resolvedId = await this.resolveWritableTenantId(tenantId);
    const existing = await this.preferenceService.getPreference(
      PreferenceName.SCRIBE_VOICE_NOTE_ENABLED,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      await this.preferenceService.updatePreference(existing.id, { enabled });
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.SCRIBE_VOICE_NOTE_ENABLED,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: { enabled },
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  async updateEnabledCustomFieldTypes(
    tenantId: string,
    enabledTypes: string[],
  ): Promise<{ success: boolean }> {
    const allTypes = Object.values(CustomFieldType);
    const invalid = enabledTypes.filter(
      (t) => !allTypes.includes(t as CustomFieldType),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid field types: ${invalid.join(', ')}`,
      );
    }

    const resolvedId = await this.resolveWritableTenantId(tenantId);

    const existing = await this.preferenceService.getPreference(
      PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
      resolvedId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    if (existing) {
      const updated = await this.preferenceService.updatePreference(
        existing.id,
        enabledTypes,
      );
      if (!updated) {
        // Row was deleted externally but still cached — create fresh
        await this.preferenceService.createPreference({
          name: PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
          relatedId: resolvedId,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: enabledTypes,
          tenantId: ExecutionManager.getTenantId(),
        });
      }
    } else {
      await this.preferenceService.createPreference({
        name: PreferenceName.ENABLED_CUSTOM_FIELD_TYPES,
        relatedId: resolvedId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: enabledTypes,
        tenantId: ExecutionManager.getTenantId(),
      });
    }
    return { success: true };
  }

  async updateChatTypes(
    updateChatTypesDto: UpdateChatTypesDto,
    entityManager?: EntityManager,
  ) {
    const { hiddenChatTypes: chatTypes, tenantId } = updateChatTypesDto;
    const invalidChatTypes = chatTypes.filter(
      (type) => !DEFAULT_CHAT_TYPES.includes(type as ChatTypes),
    );
    if (invalidChatTypes.length > 0) {
      throw new BadRequestException(
        `Invalid chat types - ${invalidChatTypes.join(', ')}`,
      );
    }

    const existingPreference = await this.preferenceService.getPreference(
      PreferenceName.HIDDEN_CHAT_TYPES,
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
      entityManager,
    );
    if (existingPreference) {
      return await this.preferenceService.updatePreference(
        existingPreference.id,
        chatTypes,
        entityManager,
      );
    }

    return await this.preferenceService.createPreference(
      {
        name: PreferenceName.HIDDEN_CHAT_TYPES,
        relatedId: tenantId,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
        value: chatTypes,
        tenantId: ExecutionManager.getTenantId(),
      },
      entityManager,
    );
  }
}
