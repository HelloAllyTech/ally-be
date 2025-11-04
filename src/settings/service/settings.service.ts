import { BadRequestException, Injectable } from '@nestjs/common';
import { CommonUtil } from '../../common/util/common.util';
import {
  DEFAULT_SUMMARY_FIELDS_ARRAY,
  DEFAULT_SUMMARY_FIELDS_SET,
} from '../constants/settings.constants';
import { PreferenceService } from '../../common/service/preference.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from '../../common/constants/user.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { SummaryPreferenceValue } from '../../common/type/common.type';
import { DEFAULT_CHAT_TYPES } from '../constants/settings.constants';
import * as _ from 'lodash';
import { ChatTypes } from '../../common/constants/chat.constants';
import {
  GetSummaryFieldsDto,
  UpdateSummaryFieldsDto,
} from '../dto/summary-fields.dto';
import { GetChatTypesDto, UpdateChatTypesDto } from '../dto/chat-types.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly preferenceService: PreferenceService,
    private readonly permissionValidator: PermissionValidator,
  ) {}

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

    const orgPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    let counselorPreference;
    if (!hasSystemAccess) {
      counselorPreference = await this.preferenceService.getPreference(
        PreferenceName.SUMMARY_HIDDEN_FIELDS,
        userId,
        PreferenceRelatedEntity.COUNSELOR,
      );
    }

    const hiddenFields = [
      ...((orgPreference?.value as SummaryPreferenceValue)?.fields || []),
      ...((counselorPreference?.value as SummaryPreferenceValue)?.fields || []),
    ];
    const hiddenFieldsSet = new Set(hiddenFields);
    const visibleFields = DEFAULT_SUMMARY_FIELDS_ARRAY.filter(
      (field) => !hiddenFieldsSet.has(field),
    );
    return visibleFields;
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
    const { hiddenFields: summaryFields, tenantId } = updateSummaryFieldsDto;
    const invalidKeys = CommonUtil.getInvalidKeysFromSet(
      DEFAULT_SUMMARY_FIELDS_SET,
      summaryFields,
    );
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `Invalid summary fields - ${invalidKeys.join(', ')}`,
      );
    }

    const relatedId = tenantId;
    const relatedEntity = PreferenceRelatedEntity.ORGANIZATION;
    const existingPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      relatedId,
      relatedEntity,
    );
    if (existingPreference) {
      return await this.preferenceService.updatePreference(
        existingPreference.id,
        {
          fields: summaryFields,
        },
      );
    }

    return await this.preferenceService.createPreference({
      name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
      relatedId,
      relatedEntity,
      value: { fields: summaryFields },
      tenantId: ExecutionManager.getTenantId(),
    });
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

    const visibleChatTypes = DEFAULT_CHAT_TYPES.filter(
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

  async updateChatTypes(updateChatTypesDto: UpdateChatTypesDto) {
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
    );
    if (existingPreference) {
      return await this.preferenceService.updatePreference(
        existingPreference.id,
        chatTypes,
      );
    }

    return await this.preferenceService.createPreference({
      name: PreferenceName.HIDDEN_CHAT_TYPES,
      relatedId: tenantId,
      relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      value: chatTypes,
      tenantId: ExecutionManager.getTenantId(),
    });
  }
}
