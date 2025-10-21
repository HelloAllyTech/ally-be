import {
  BadRequestException,
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

@Injectable()
export class TenantService {
  private readonly logger = LoggerService.getInstance(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly tenantsRepository: TenantsRepository,
  ) {}
  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }
  async create(tenantData: Partial<Tenant>): Promise<Tenant> {
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
    return this.tenantsRepository.getallTenants(search, options);
  }
  async updateTenant(
    id: string,
    updateTenantDto: UpdateTenantDto,
  ): Promise<Tenant | null> {
    const tenant = await this.findById(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }
    if (updateTenantDto.name && updateTenantDto.name !== tenant.name) {
      const existingTenantWithName = await this.tenantRepository.findOne({
        where: {
          name: updateTenantDto.name,
          id: Not(id), // Exclude current tenant
        },
      });
      if (existingTenantWithName) {
        throw new BadRequestException(
          `Tenant with name "${updateTenantDto.name}" already exists`,
        );
      }
    }
    await this.tenantRepository.update(id, updateTenantDto as Partial<Tenant>);

    return this.findById(id);
  }
}
