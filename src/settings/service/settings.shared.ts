import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalSettingsRepository } from '../repository/global-settings.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { GlobalSettings } from '../entity/global-settings.entity';
import {
  CreateAppVersionSettingsDto,
  UpdateAppVersionSettingsDto,
} from 'src/app-version/dto/app-version-settings.dto';
import { AppVersionSettingsEnum, LegalContentKey } from '../type/settings.type';
import {
  LegalContentResponseDto,
  UpdateLegalContentDto,
} from '../dto/legal-content.dto';
import { sanitizeLegalHtml } from 'src/common/util/sanitize-html.util';
import { MinimumVersionResponseDto } from 'src/app-version/dto/minimum-version-response.dto';
import { In } from 'typeorm';

@Injectable()
export class SettingsShared {
  constructor(
    private readonly globalSettingsRepository: GlobalSettingsRepository,
  ) {}

  /**
   * Read platform-wide legal/consent HTML by key. Returns an empty string
   * (not a 404) when the row has not been created yet, so clients can render
   * gracefully before an admin has saved any content.
   */
  async getLegalContent(key: LegalContentKey): Promise<LegalContentResponseDto> {
    const setting = await this.globalSettingsRepository.findOne({
      where: { name: key },
    });
    return { html: (setting?.value?.html as string) ?? '' };
  }

  /**
   * Upsert platform-wide legal/consent HTML by key.
   */
  async updateLegalContent(
    key: LegalContentKey,
    dto: UpdateLegalContentDto,
  ): Promise<{ success: boolean }> {
    const userId = Number(ExecutionManager.getUserId());

    // Sanitize on write so every consumer gets safe HTML regardless of client.
    const value: Record<string, any> = { html: sanitizeLegalHtml(dto.html) };

    const existing = await this.globalSettingsRepository.findOne({
      where: { name: key },
    });

    if (existing) {
      await this.globalSettingsRepository.update(existing.id, {
        value,
        updatedBy: userId,
      });
    } else {
      const created = this.globalSettingsRepository.create({
        name: key,
        value,
        createdBy: userId,
        updatedBy: userId,
      });
      await this.globalSettingsRepository.save(created);
    }

    return { success: true };
  }

  async createGlobalSettings(
    createAppVersionSettingsDto: CreateAppVersionSettingsDto,
  ): Promise<{ data: GlobalSettings[] }> {
    const userId = Number(ExecutionManager.getUserId());

    this.validateGlobalSettingsKeys(createAppVersionSettingsDto);

    const settingsToCreate: GlobalSettings[] = [];

    const names: string[] = [];
    for (const enumKey of Object.keys(
      AppVersionSettingsEnum,
    ) as (keyof typeof AppVersionSettingsEnum)[]) {
      const data = createAppVersionSettingsDto[enumKey];
      if (data === undefined) continue;
      names.push(AppVersionSettingsEnum[enumKey]);
    }

    const existingGlobalSettings = await this.globalSettingsRepository.find({
      where: { name: In(names) },
    });

    if (existingGlobalSettings.length > 0) {
      const existingNames = existingGlobalSettings.map(
        (setting) => setting.name,
      );
      throw new BadRequestException(
        `Global settings already exists${existingNames.join(', ')}`,
      );
    }

    for (const enumKey of Object.keys(
      AppVersionSettingsEnum,
    ) as (keyof typeof AppVersionSettingsEnum)[]) {
      const data = createAppVersionSettingsDto[enumKey];
      if (data === undefined) continue;

      const name = AppVersionSettingsEnum[enumKey];

      const globalSettings = this.globalSettingsRepository.create({
        name,
        value: { minimumSupportedVersion: data },
        createdBy: userId,
        updatedBy: userId,
      });

      settingsToCreate.push(globalSettings);
    }

    const savedSettings =
      await this.globalSettingsRepository.save(settingsToCreate);
    return { data: savedSettings };
  }

  async updateGlobalSettings(
    updateAppVersionSettingsDto: UpdateAppVersionSettingsDto,
  ): Promise<{ data: GlobalSettings[] }> {
    const userId = Number(ExecutionManager.getUserId());

    this.validateGlobalSettingsKeys(updateAppVersionSettingsDto);

    const nameToValueMap = new Map<string, string>();
    for (const enumKey of Object.keys(
      AppVersionSettingsEnum,
    ) as (keyof typeof AppVersionSettingsEnum)[]) {
      const val = updateAppVersionSettingsDto[enumKey];
      if (val === undefined) continue;
      nameToValueMap.set(AppVersionSettingsEnum[enumKey], val);
    }

    const names = [...nameToValueMap.keys()];
    const existingSettings = await this.globalSettingsRepository.find({
      where: { name: In(names) },
    });

    const existingMap = new Map(
      existingSettings.map((setting) => [setting.name, setting]),
    );

    const missingNames = names.filter((name) => !existingMap.has(name));
    if (missingNames.length > 0) {
      throw new NotFoundException(
        `Global settings not found: ${missingNames.join(', ')}`,
      );
    }

    for (const [name, val] of nameToValueMap) {
      const existing = existingMap.get(name)!;
      const updatedValue: Record<string, any> = {
        minimumSupportedVersion: val,
      };
      await this.globalSettingsRepository.update(existing.id, {
        value: updatedValue,
        updatedBy: userId,
      });
    }

    const updatedSettings = await this.globalSettingsRepository.find({
      where: { name: In(names) },
    });

    return { data: updatedSettings };
  }

  async getGlobalSettings(name: string): Promise<MinimumVersionResponseDto> {
    const globalSettings = await this.globalSettingsRepository.findOne({
      where: {
        name: AppVersionSettingsEnum[
          name as keyof typeof AppVersionSettingsEnum
        ],
      },
    });
    if (!globalSettings) {
      throw new NotFoundException('Global settings not found');
    }
    return {
      minimumSupportedVersion: globalSettings.value.minimumSupportedVersion,
    };
  }

  validateGlobalSettingsKeys(
    dto: CreateAppVersionSettingsDto | UpdateAppVersionSettingsDto,
  ) {
    const dtoKeys = Object.keys(dto);
    const validEnumKeys = Object.keys(AppVersionSettingsEnum);

    const invalidKeys = dtoKeys.filter((key) => !validEnumKeys.includes(key));
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `Invalid keys provided: ${invalidKeys.join(', ')}`,
      );
    }
  }
}
