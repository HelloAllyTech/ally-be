import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudTelephonyIntegration } from '../entity/cloud-telephony-integration.entity';

@Injectable()
export class CloudTelephonyRepository {
  constructor(
    @InjectRepository(CloudTelephonyIntegration)
    private readonly cloudTelephonyRepository: Repository<CloudTelephonyIntegration>,
  ) {}

  async create(
    data: Partial<CloudTelephonyIntegration>,
  ): Promise<CloudTelephonyIntegration> {
    const integration = await this.cloudTelephonyRepository.create(data);
    return await this.cloudTelephonyRepository.save(integration);
  }

  async findById(id: string): Promise<CloudTelephonyIntegration | null> {
    return await this.cloudTelephonyRepository.findOne({ where: { id } });
  }

  async findByCode(code: string): Promise<CloudTelephonyIntegration | null> {
    return await this.cloudTelephonyRepository.findOne({ where: { code } });
  }

  async findByTenantId(
    tenantId: string,
  ): Promise<CloudTelephonyIntegration | null> {
    return await this.cloudTelephonyRepository.findOne({ where: { tenantId } });
  }

  async updateById(
    id: string,
    data: Partial<CloudTelephonyIntegration>,
  ): Promise<void> {
    await this.cloudTelephonyRepository.update(id, data);
  }
}
