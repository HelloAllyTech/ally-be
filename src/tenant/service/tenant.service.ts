import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Tenant, TenantStatus } from '../../common/entities/tenant.entity';
import { LoggerService } from '../../logger/logger.service';
import { TenantsRepository } from '../repository/tenant.repository';
import { Pagination } from 'src/common/type/common.type';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { GetAllTenantsResponseDto } from '../dto/get-tenants.dto';
import { UserRepository } from 'src/user/repository/user.repository';

@Injectable()
export class TenantService {
  private readonly logger = LoggerService.getInstance(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantsRepository: TenantsRepository,
    @Inject(forwardRef(() => UserRepository))
    private readonly userRepository: UserRepository,
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

    const tenant = this.tenantRepository.create(tenantData);
    return this.tenantRepository.save(tenant);
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
    await this.tenantRepository.update(id, updateTenantDto as Partial<Tenant>);
    return this.findById(id);
  }
}
