import { BadRequestException, Injectable } from '@nestjs/common';
import { CommonUtil } from '../../common/util/common.util';
import { DEFAULT_SUMMARY_FIELDS } from '../constants/settings.constants';
import { PreferenceService } from '../../common/service/preference.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  PreferenceName,
  PreferenceRelatedEntity,
  UserRole,
} from '../../common/constants/user.constants';

@Injectable()
export class SettingsService {
  constructor(private readonly preferenceService: PreferenceService) {}

  async getSummaryFieldsConfig() {
    const orgPreference = await this.preferenceService.getPreference(
      ExecutionManager.getTenantId()!,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    const counselorPreference = await this.preferenceService.getPreference(
      ExecutionManager.getUserId()!,
      PreferenceRelatedEntity.COUNSELOR,
    );
    const hiddenFields = [
      ...(orgPreference?.value?.fields || []),
      ...(counselorPreference?.value?.fields || []),
    ];
    const summaryFields = CommonUtil.setKeysToValue(
      DEFAULT_SUMMARY_FIELDS,
      hiddenFields,
      false,
    );

    return summaryFields;
  }

  async getHiddenSummaryFields() {
    const orgPreference = await this.preferenceService.getPreference(
      ExecutionManager.getTenantId()!,
      PreferenceRelatedEntity.ORGANIZATION,
    );
    const counselorPreference = await this.preferenceService.getPreference(
      ExecutionManager.getUserId()!,
      PreferenceRelatedEntity.COUNSELOR,
    );
    const hiddenFields = [
      ...(orgPreference?.value?.fields || []),
      ...(counselorPreference?.value?.fields || []),
    ];
    return hiddenFields;
  }

  async updateSummaryFields(summaryFields: string[]) {
    if (!summaryFields?.length) {
      throw new BadRequestException('Summary fields are required');
    }
    const invalidKeys = CommonUtil.getInvalidKeys(
      DEFAULT_SUMMARY_FIELDS,
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
      relatedId,
      relatedEntity,
    );
    if (existingPreference) {
      return await this.preferenceService.updatePreference({
        ...existingPreference,
        value: { fields: summaryFields },
      });
    }

    return await this.preferenceService.createPreference({
      name: PreferenceName.SUMMARY_HIDDEN_FIELDS,
      relatedId,
      relatedEntity,
      value: { fields: summaryFields },
      tenantId: ExecutionManager.getTenantId(),
    });
  }
}
