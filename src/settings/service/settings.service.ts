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
  HiddenChatType,
} from '../../common/constants/user.constants';
import { SummaryPreferenceValue } from '../../common/type/common.type';
import * as _ from 'lodash';

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

  async getHiddenChatTypes(): Promise<string[]> {
    const tenantId = ExecutionManager.getTenantId();

    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.getHiddenChatTypesForEntity(
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );
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

    try {
      const hiddenChatTypes = preference.value as string[];
      return Array.isArray(hiddenChatTypes) ? hiddenChatTypes : [];
    } catch (error) {
      console.error('Failed to parse hidden chat types:', error);
      return [];
    }
  }

  async addHiddenChatTypes(chatTypes: string[]): Promise<string[]> {
    const tenantId = ExecutionManager.getTenantId();

    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!chatTypes || chatTypes.length === 0) {
      throw new BadRequestException('Chat types are required');
    }

    // VALIDATION: Check if all chat types are valid enum values
    const validChatTypes = Object.values(HiddenChatType);
    const invalidTypes = chatTypes.filter(
      (type) => !validChatTypes.includes(type as HiddenChatType),
    );

    if (invalidTypes.length > 0) {
      throw new BadRequestException(
        `Invalid chat types: ${invalidTypes.join(', ')}`,
      );
    }

    const currentHiddenTypes = await this.getHiddenChatTypesForEntity(
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    const newHiddenTypes = chatTypes.filter(
      (chatType) => !currentHiddenTypes.includes(chatType),
    );

    if (newHiddenTypes.length > 0) {
      const updatedHiddenTypes = [...currentHiddenTypes, ...newHiddenTypes];
      await this.updateHiddenChatTypesForEntity(
        tenantId,
        PreferenceRelatedEntity.ORGANIZATION,
        updatedHiddenTypes,
      );
      return updatedHiddenTypes;
    }

    return currentHiddenTypes;
  }

  async removeHiddenChatTypes(chatTypes: string[]): Promise<string[]> {
    const tenantId = ExecutionManager.getTenantId();

    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!chatTypes || chatTypes.length === 0) {
      throw new BadRequestException('Chat types are required');
    }

    // VALIDATION: Check if all chat types are valid enum values
    const validChatTypes = Object.values(HiddenChatType);
    const invalidTypes = chatTypes.filter(
      (type) => !validChatTypes.includes(type as HiddenChatType),
    );

    if (invalidTypes.length > 0) {
      throw new BadRequestException(
        `Invalid chat types: ${invalidTypes.join(', ')}`,
      );
    }

    // Get the current preference entity
    const preference = await this.preferenceService.getPreference(
      PreferenceName.HIDDEN_CHAT_TYPES,
      tenantId,
      PreferenceRelatedEntity.ORGANIZATION,
    );

    if (!preference) {
      throw new BadRequestException('Preference not found');
    }

    const currentHiddenTypes = Array.isArray(preference.value)
      ? preference.value
      : [];
    const updatedHiddenTypes = currentHiddenTypes.filter(
      (type) => !chatTypes.includes(type),
    );

    await this.preferenceService.updatePreference(
      preference.id,
      updatedHiddenTypes,
    );

    return updatedHiddenTypes;
  }

  private async updateHiddenChatTypesForEntity(
    relatedId: string,
    relatedEntity: string,
    hiddenChatTypes: string[],
  ) {
    const preference = await this.preferenceService.getPreference(
      PreferenceName.HIDDEN_CHAT_TYPES,
      relatedId,
      relatedEntity,
    );

    if (preference) {
      return this.preferenceService.updatePreference(
        preference.id,
        hiddenChatTypes,
      );
    } else {
      return this.preferenceService.createPreference({
        name: PreferenceName.HIDDEN_CHAT_TYPES,
        relatedId,
        relatedEntity,
        value: hiddenChatTypes,
        tenantId: ExecutionManager.getTenantId(),
      });
    }
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
}
