import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Tenant, TenantStatus } from '../entity/tenant.entity';
import { LoggerService } from '../../logger/logger.service';
import { TenantsRepository } from '../repository/tenant.repository';
import { Pagination } from 'src/common/type/common.type';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { GetAllTenantsResponseDto } from '../dto/get-tenants.dto';
import { UserRepository } from '../../user/repository/user.repository';
import { TenantScenarioSharedService } from './tenant-scenario-shared';
import { TenantScenarioPathSharedService } from './tenant-scenario-path-shared';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';
import { BadgeTenantSharedService } from 'src/badge/service/badge-tenant-shared.service';
import {
  LogoUploadRequestDto,
  OrganizationLogoUploadResponseDto,
} from '../dto/organization-logo-upload.dto';

import { DeleteLogoDto } from '../dto/delete-organization-logo.dto';
import { LogoUploadContentType } from '../enum/tenant.enum';
import { TenantDashboardSharedService } from './tenant-dashboard-shared';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { SettingsService } from 'src/settings/service/settings.service';
import { ChatTypes } from 'src/common/constants/chat.constants';
import { TenantResponseDto } from '../dto/tenant-response.dto';
import { PreferenceRelatedEntity } from 'src/common/constants/user.constants';
import { PreferenceService } from 'src/settings/service/preference.service';
import { TenantCaseSharedService } from './tenant-case-shared';
import { PermissionsService } from '../../authorization/service/permissions.service';
import { AdminTenantService } from '../../user/service/admin-tenant.service';

@Injectable()
export class TenantService {
  private readonly logger = LoggerService.getInstance(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantsRepository: TenantsRepository,
    private readonly tenantScenarioSharedService: TenantScenarioSharedService,
    private readonly tenantScenarioPathSharedService: TenantScenarioPathSharedService,
    private readonly badgeTenantSharedService: BadgeTenantSharedService,
    private readonly tenantDashboardSharedService: TenantDashboardSharedService,
    @Inject(forwardRef(() => UserRepository))
    private readonly userRepository: UserRepository,
    private readonly dataSource: DataSource,
    private configService: AppConfigService,
    private s3Service: S3Service,
    private readonly settingsService: SettingsService,
    private readonly preferenceService: PreferenceService,
    private readonly tenantCaseSharedService: TenantCaseSharedService,
    @Inject(forwardRef(() => PermissionsService))
    private permissionsService: PermissionsService,
    @Inject(forwardRef(() => AdminTenantService))
    private adminTenantService: AdminTenantService,
  ) {}

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }

  async create(
    tenantData: CreateTenantDto,
    status: TenantStatus,
  ): Promise<Tenant> {
    const existingTenant = await this.tenantRepository.findOne({
      where: [{ name: tenantData.name }, { code: tenantData.code }],
    });
    if (existingTenant?.name == tenantData.name) {
      throw new ConflictException(
        `Tenant with name "${tenantData.name}" already exists`,
      );
    }
    if (existingTenant?.code === tenantData.code) {
      throw new ConflictException(
        `Tenant with code "${tenantData.code}" already exists`,
      );
    }

    if (
      tenantData.enabledDashboardIds &&
      tenantData.enabledDashboardIds.length > 0
    ) {
      await this.tenantDashboardSharedService.validateDashboardIds(
        tenantData.enabledDashboardIds,
        this.dataSource.manager,
      );
    }

    tenantData.settings = {
      ...(tenantData.settings ?? {}),
      hideRankInCommunity: tenantData.hideRankInCommunity ?? false,
    };

    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    if (userId) {
      tenantData = {
        ...tenantData,
        ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
      };
    }

    try {
      const result = await this.dataSource.transaction(
        async (entityManager) => {
          const tenant = entityManager.create(Tenant, {
            ...tenantData,
            status,
          });
          const savedTenant = await entityManager.save(Tenant, tenant);

          await this.tenantScenarioSharedService.assignGlobalScenariosToTenant(
            savedTenant.id,
            entityManager,
          );

          await this.tenantScenarioPathSharedService.assignGlobalScenarioPathsToTenant(
            savedTenant.id,
            entityManager,
          );

          await this.tenantCaseSharedService.assignGlobalCasesToTenant(
            savedTenant.id,
            entityManager,
          );

          await this.badgeTenantSharedService.addPublicBadgesToTenant(
            savedTenant.id,
            entityManager,
          );

          if (
            tenantData.enabledDashboardIds &&
            tenantData.enabledDashboardIds.length > 0
          ) {
            await this.tenantDashboardSharedService.assignDashboardsToTenant(
              savedTenant.id,
              tenantData.enabledDashboardIds,
              entityManager,
            );
          }

          // Pass the hidden chat types to the settings service
          const hiddenChatTypes = <ChatTypes[]>[];
          if (!(tenantData.enableAudioUpload ?? false)) {
            hiddenChatTypes.push(ChatTypes.AUDIO_UPLOAD);
          }
          if (!(tenantData.enableMicrophoneMode ?? false)) {
            hiddenChatTypes.push(ChatTypes.MICROPHONE_CHAT);
          }
          if (hiddenChatTypes.length > 0) {
            await this.settingsService.updateChatTypes(
              { tenantId: savedTenant.id, hiddenChatTypes },
              entityManager,
            );
          }

          return savedTenant;
        },
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to create tenant: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to create tenant: ${error.message}`,
      );
    }
  }

  async findById(
    id: string,
    options?: { includeUserCount?: boolean },
  ): Promise<TenantResponseDto | null> {
    const tenant = await this.findTenantEntityById(id);
    if (!tenant) return null;
    return this.buildTenantResponse(tenant, options);
  }

  async findByCode(code: string): Promise<TenantResponseDto | null> {
    const tenant = await this.tenantRepository.findOne({ where: { code } });
    if (!tenant) return null;
    return this.buildTenantResponse(tenant);
  }

  private async findTenantEntityById(id: string): Promise<Tenant | null> {
    return this.tenantRepository.findOne({ where: { id } });
  }

  private async buildTenantResponse(
    tenant: Tenant,
    options?: { includeUserCount?: boolean },
  ): Promise<TenantResponseDto> {
    const promises: [
      Promise<{ tenantId: string; dashboardIds: string[] }[]>,
      Promise<string[]>,
      Promise<{ tenantId: string; userCount: string }[]>,
    ] = [
      this.tenantDashboardSharedService.getEnabledDashboardIdsForTenants(
        [tenant.id],
        this.dataSource.manager,
      ),
      this.settingsService.getHiddenChatTypesForEntity(
        tenant.id,
        PreferenceRelatedEntity.ORGANIZATION,
      ),
      options?.includeUserCount
        ? this.userRepository.getUserCountByTenantIds([tenant.id])
        : Promise.resolve([{ tenantId: tenant.id, userCount: '0' }]),
    ];

    const [dashboardIdsList, hiddenChatTypes, userCountResult] =
      await Promise.all(promises);

    return {
      ...tenant,
      enabledDashboardIds: dashboardIdsList[0]?.dashboardIds ?? [],
      hideRankInCommunity: tenant.settings?.hideRankInCommunity ?? false,
      enableAudioUpload: !hiddenChatTypes.includes(ChatTypes.AUDIO_UPLOAD),
      enableMicrophoneMode: !hiddenChatTypes.includes(
        ChatTypes.MICROPHONE_CHAT,
      ),
      ...(options?.includeUserCount
        ? { userCount: parseInt(userCountResult?.[0]?.userCount ?? '0', 10) }
        : {}),
    };
  }

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    return this.tenantsRepository.updateStatus(id, status);
  }

  async updateSettings(
    id: string,
    settings: Record<string, any>,
  ): Promise<Tenant | null> {
    await this.tenantRepository.update(id, { settings });
    return this.findTenantEntityById(id);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, any>,
  ): Promise<Tenant | null> {
    await this.tenantRepository.update(id, { metadata });
    return this.findTenantEntityById(id);
  }

  async validateTenant(tenantId: string): Promise<boolean> {
    const tenant = await this.findTenantEntityById(tenantId);
    return tenant !== null && tenant.status === TenantStatus.ACTIVE;
  }

  async getallTenants(
    search?: string,
    options?: Pagination,
  ): Promise<GetAllTenantsResponseDto> {
    const userId = ExecutionManager.getUserId();

    const isMultiTenantAdmin = userId
      ? await this.permissionsService.isMultiTenantAdmin(Number(userId))
      : false;

    let tenantsIds: string[] = [];
    if (isMultiTenantAdmin) {
      const adminTenants = await this.adminTenantService.getTenantsForAdmin(
        Number(userId),
      );
      tenantsIds = adminTenants.data.map((t: any) => t.id);
    }

    const { tenants, count } = await this.tenantsRepository.getallTenants(
      search,
      options,
      tenantsIds,
    );
    if (tenants.length == 0) {
      return { data: [], count: 0 };
    }

    const tenantIds = tenants.map((t) => t.id);

    const [userCount, dashboardIdsPerTenant, hiddenChatTypesPerTenant] =
      await Promise.all([
        this.userRepository.getUserCountByTenantIds(tenantIds),
        this.tenantDashboardSharedService.getEnabledDashboardIdsForTenants(
          tenantIds,
          this.dataSource.manager,
        ),
        this.preferenceService.getHiddenChatTypesForTenants(tenantIds),
      ]);

    const userCountMap = new Map(
      userCount.map((uc) => [uc.tenantId, parseInt(uc.userCount)]),
    );

    const tenantsWithDetails = tenants.map((tenant) => {
      const hiddenChatTypes =
        hiddenChatTypesPerTenant.find((entry) => entry.tenantId === tenant.id)
          ?.hiddenChatTypes ?? [];
      const enabledDashboardIds =
        dashboardIdsPerTenant.find((entry) => entry.tenantId === tenant.id)
          ?.dashboardIds ?? [];
      return {
        ...tenant,
        userCount: userCountMap.get(tenant.id) || 0,
        enabledDashboardIds,
        hideRankInCommunity: tenant.settings?.hideRankInCommunity ?? false,
        enableAudioUpload: !hiddenChatTypes.includes(ChatTypes.AUDIO_UPLOAD),
        enableMicrophoneMode: !hiddenChatTypes.includes(
          ChatTypes.MICROPHONE_CHAT,
        ),
      };
    });

    return {
      data: tenantsWithDetails,
      count,
    };
  }

  async updateTenant(
    id: string,
    updateTenantDto: UpdateTenantDto,
  ): Promise<TenantResponseDto | null> {
    const tenant = await this.findTenantEntityById(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }
    if (
      (updateTenantDto.name && updateTenantDto.name !== tenant.name) ||
      (updateTenantDto.code && updateTenantDto.code !== tenant.code)
    ) {
      const existingTenant = await this.tenantRepository.findOne({
        where: [
          { name: updateTenantDto.name, id: Not(id) },
          { code: updateTenantDto.code, id: Not(id) },
        ],
      });
      if (existingTenant?.name == updateTenantDto.name) {
        throw new BadRequestException(
          `Tenant with name "${updateTenantDto.name}" already exists`,
        );
      }
      if (existingTenant?.code === updateTenantDto.code) {
        throw new BadRequestException(
          `Tenant with code "${updateTenantDto.code}" already exists`,
        );
      }
    }

    // Separate non-entity fields from the update data
    const {
      enabledDashboardIds,
      enableMicrophoneMode,
      enableAudioUpload,
      hideRankInCommunity,
      ...tenantUpdateData
    } = updateTenantDto;

    if (enabledDashboardIds && enabledDashboardIds.length > 0) {
      await this.tenantDashboardSharedService.validateDashboardIds(
        enabledDashboardIds,
        this.dataSource.manager,
      );
    }

    // Handle hideRankInCommunity - merge into current settings if true
    let settingsUpdate: Record<string, any> | undefined;
    if (hideRankInCommunity !== undefined) {
      const currentSettings = tenant.settings ?? {};
      settingsUpdate = {
        ...currentSettings,
        hideRankInCommunity: hideRankInCommunity,
      };
    }

    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;

    const updatedTenantData = {
      ...tenantUpdateData,
      ...(settingsUpdate ? { settings: settingsUpdate } : {}),
      ...(userId ? { updatedBy: userId } : {}),
    };

    try {
      await this.dataSource.transaction(async (entityManager) => {
        await entityManager.update(
          Tenant,
          id,
          updatedTenantData as Partial<Tenant>,
        );

        // Handle chat types if explicitly provided
        if (
          enableAudioUpload !== undefined ||
          enableMicrophoneMode !== undefined
        ) {
          const hiddenChatTypes = <ChatTypes[]>[];
          if (
            enableAudioUpload !== undefined &&
            !(enableAudioUpload ?? false)
          ) {
            hiddenChatTypes.push(ChatTypes.AUDIO_UPLOAD);
          }
          if (
            enableMicrophoneMode !== undefined &&
            !(enableMicrophoneMode ?? false)
          ) {
            hiddenChatTypes.push(ChatTypes.MICROPHONE_CHAT);
          }

          await this.settingsService.updateChatTypes(
            { tenantId: id, hiddenChatTypes },
            entityManager,
          );
        }

        // Handle dashboard assignments
        if (enabledDashboardIds) {
          await this.tenantDashboardSharedService.assignDashboardsToTenant(
            id,
            enabledDashboardIds,
            entityManager,
          );
        }
      });
      return this.findById(id);
    } catch (error) {
      this.logger.error(
        `Failed to update tenant: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to update tenant: ${error.message}`,
      );
    }
  }

  async getPresignedUrlForOrganizationLogo(
    logoUploadRequestDto: LogoUploadRequestDto,
  ): Promise<OrganizationLogoUploadResponseDto> {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assets bucket is not defined');
    }

    const { fileName, fileSize, contentType } = logoUploadRequestDto;

    if (!Object.values(LogoUploadContentType).includes(contentType)) {
      throw new BadRequestException('Invalid file type');
    }

    const maxFileSize = 2 * 1024 * 1024; // 2 MB
    if (fileSize > maxFileSize) {
      throw new BadRequestException(
        `File size must be less than ${maxFileSize / 1024 / 1024} MB`,
      );
    }
    const uuid = uuidv4();
    const userId = ExecutionManager.getUserId();
    const sanitizedFileName = this.s3Service.sanitizeFileName(fileName);

    const storageKey = `org-logos/${userId}-${uuid}-${sanitizedFileName}`;
    const presignedUrl = await this.s3Service.generatePresignedUrl({
      bucket,
      key: storageKey,
      operation: 'put',
      expiresIn: 600, // 10 minutes
      contentType,
    });

    const region = this.configService.aws.region;
    const logoUrl = `https://${bucket}.s3.${region}.amazonaws.com/${storageKey}`;

    return { presignedUrl, logoUrl };
  }

  async deleteOrganizationLogo(deleteLogoDto: DeleteLogoDto) {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      throw new Error('S3 bucket name for assets bucket is not defined');
    }

    const logoUrl = deleteLogoDto.logoUrl;
    const s3LogoUrlPattern =
      /^https:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com\/(.+)$/;
    const logoUrlMatch = logoUrl.match(s3LogoUrlPattern);
    const storageKey = logoUrlMatch ? logoUrlMatch[1] : null;
    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 URL: ${logoUrl}`);
      return { success: false };
    }
    if (!storageKey) {
      this.logger.warn(`Invalid or unrecognized S3 storage Key: ${storageKey}`);
      return { success: false };
    }
    try {
      await this.s3Service.deleteObject({
        bucket,
        key: storageKey,
      });
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to delete uploaded logo with error ${JSON.stringify(error)}`,
      );
      return { success: false };
    }
  }
}
