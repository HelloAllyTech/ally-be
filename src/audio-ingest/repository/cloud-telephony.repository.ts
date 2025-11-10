import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CloudTelephonyIntegration } from '../entity/cloud-telephony-integration.entity';

@Injectable()
export class CloudTelephonyRepository extends Repository<CloudTelephonyIntegration> {
  constructor(private dataSource: DataSource) {
    super(CloudTelephonyIntegration, dataSource.createEntityManager());
  }

  async createIntegration(
    data: Partial<CloudTelephonyIntegration>,
    em?: EntityManager,
  ): Promise<CloudTelephonyIntegration> {
    const repo = em
      ? em.getRepository(CloudTelephonyIntegration)
      : this.dataSource.getRepository(CloudTelephonyIntegration);

    const integration = repo.create(data);
    return repo.save(integration);
  }

  async findById(
    id: string,
    em?: EntityManager,
  ): Promise<CloudTelephonyIntegration | null> {
    const repo = em ? em.getRepository(CloudTelephonyIntegration) : this;

    return repo.findOne({ where: { id } });
  }

  async findByCode(
    code: string,
    em?: EntityManager,
  ): Promise<CloudTelephonyIntegration | null> {
    const repo = em ? em.getRepository(CloudTelephonyIntegration) : this;

    return repo.findOne({ where: { code } });
  }

  async findByTenantId(
    tenantId: string,
    em?: EntityManager,
  ): Promise<CloudTelephonyIntegration | null> {
    const repo = em ? em.getRepository(CloudTelephonyIntegration) : this;

    return repo.findOne({ where: { tenantId } });
  }

  async updateById(
    id: string,
    data: Partial<CloudTelephonyIntegration>,
    em?: EntityManager,
  ): Promise<boolean> {
    const repo = em
      ? em.getRepository(CloudTelephonyIntegration)
      : this.dataSource.getRepository(CloudTelephonyIntegration);

    const result = await repo.update(id, data);
    return result.affected !== 0;
  }

  async deleteById(id: string, em?: EntityManager): Promise<boolean> {
    const repo = em
      ? em.getRepository(CloudTelephonyIntegration)
      : this.dataSource.getRepository(CloudTelephonyIntegration);

    const result = await repo.delete(id);
    return result.affected !== 0;
  }
}
