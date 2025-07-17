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
  UserRole,
} from '../../common/constants/user.constants';
import { SummaryPreferenceValue } from '../../common/type/common.type';
import { DEFAULT_CHAT_TYPES } from '../constants/settings.constants';
import * as _ from 'lodash';
import { ChatTypes } from '../../common/constants/chat.constants';

@Injectable()
export class SettingsService {
  constructor(private readonly preferenceService: PreferenceService) {}

  async getSummaryFieldsConfig() {
    const tenantId = ExecutionManager.getTenantId();
    const userId = ExecutionManager.getUserId();
    if (!tenantId || !userId) {
      throw new BadRequestException('Tenant ID and User ID are required');
    }
    const orgPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    const counselorPreference = await this.preferenceService.getPreference(
      PreferenceName.SUMMARY_HIDDEN_FIELDS,
      userId,
      PreferenceRelatedEntity.COUNSELOR,
    );
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

  async updateSummaryFields(summaryFields: string[]) {
    const invalidKeys = CommonUtil.getInvalidKeysFromSet(
      DEFAULT_SUMMARY_FIELDS_SET,
      summaryFields,
    );
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `Invalid summary fields - ${invalidKeys.join(', ')}`,
      );
    }
    const relatedId =
      ExecutionManager.getRole() === UserRole.ADMIN
        ? ExecutionManager.getTenantId()
        : ExecutionManager.getUserId();
    const relatedEntity =
      ExecutionManager.getRole() === UserRole.ADMIN
        ? PreferenceRelatedEntity.ORGANIZATION
        : PreferenceRelatedEntity.COUNSELOR;
    if (!relatedId || !relatedEntity) {
      throw new BadRequestException('Related ID or Entity is required');
    }
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
    const relatedId =
      ExecutionManager.getRole() === UserRole.ADMIN
        ? ExecutionManager.getTenantId()
        : ExecutionManager.getUserId();
    const relatedEntity =
      ExecutionManager.getRole() === UserRole.ADMIN
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

  async getChatTypes(): Promise<string[]> {
    const tenantId = ExecutionManager.getTenantId();

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

  async updateChatTypes(chatTypes: string[]) {
    const invalidChatTypes = chatTypes.filter(
      (type) => !DEFAULT_CHAT_TYPES.includes(type as ChatTypes),
    );
    if (invalidChatTypes.length > 0) {
      throw new BadRequestException(
        `Invalid chat types - ${invalidChatTypes.join(', ')}`,
      );
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
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
