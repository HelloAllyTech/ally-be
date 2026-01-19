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
import { UserRepository } from 'src/user/repository/user.repository';
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
    @Inject(forwardRef(() => UserRepository))
    private readonly userRepository: UserRepository,
    private readonly dataSource: DataSource,
    private configService: AppConfigService,
    private s3Service: S3Service,
  ) {}

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }

  async create(tenantData: Partial<Tenant>): Promise<Tenant> {
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
          const tenant = entityManager.create(Tenant, tenantData);
          const savedTenant = await entityManager.save(Tenant, tenant);

          await this.tenantScenarioSharedService.assignGlobalScenariosToTenant(
            savedTenant.id,
            entityManager,
          );

          await this.tenantScenarioPathSharedService.assignGlobalScenarioPathsToTenant(
            savedTenant.id,
            entityManager,
          );

          await this.badgeTenantSharedService.addPublicBadgesToTenant(
            savedTenant.id,
            entityManager,
          );

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

  async findById(id: string): Promise<Tenant | null> {
    return this.tenantRepository.findOne({ where: { id } });
  }

  async findByCode(code: string): Promise<Tenant | null> {
    return this.tenantRepository.findOne({ where: { code } });
  }

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const result = await this.tenantRepository
      .createQueryBuilder()
      .update(Tenant)
      .set({ status })
      .where('id = :id', { id })
      .returning('*')
      .execute();
    return result.affected ? result.raw[0] : null;
  }

  async updateSettings(
    id: string,
    settings: Record<string, any>,
  ): Promise<Tenant | null> {
    await this.tenantRepository.update(id, { settings });
    return this.findById(id);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, any>,
  ): Promise<Tenant | null> {
    await this.tenantRepository.update(id, { metadata });
    return this.findById(id);
  }

  async validateTenant(tenantId: string): Promise<boolean> {
    const tenant = await this.findById(tenantId);
    return tenant !== null && tenant.status === TenantStatus.ACTIVE;
  }

  async getallTenants(
    search?: string,
    options?: Pagination,
  ): Promise<GetAllTenantsResponseDto> {
    const { tenants, count } = await this.tenantsRepository.getallTenants(
      search,
      options,
    );
    if (tenants.length == 0) {
      return { data: [], count: 0 };
    }

    const tenantIds = tenants.map((t) => t.id);

    const userCount =
      await this.userRepository.getUserCountByTenantIds(tenantIds);

    const userCountMap = new Map(
      userCount.map((uc) => [uc.tenantId, parseInt(uc.userCount)]),
    );

    const tenantsWithUserCount = tenants.map((tenant) => ({
      ...tenant,
      userCount: userCountMap.get(tenant.id) || 0,
    }));

    return {
      data: tenantsWithUserCount,
      count,
    };
  }

  async updateTenant(
    id: string,
    updateTenantDto: UpdateTenantDto,
  ): Promise<Tenant | null> {
    const tenant = await this.findById(id);
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
    const userIdStr = ExecutionManager.getUserId();
    const userId = userIdStr ? Number(userIdStr) : undefined;
    const updatedTenantData = {
      ...updateTenantDto,
      ...(userId ? { updatedBy: userId } : {}),
    };
    await this.tenantRepository.update(
      id,
      updatedTenantData as Partial<Tenant>,
    );
    return this.findById(id);
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
