import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminFeatureToggle } from '../entity/admin-feature-toggle.entity';

@Injectable()
export class AdminFeatureToggleRepository extends Repository<AdminFeatureToggle> {
  constructor(private dataSource: DataSource) {
    super(AdminFeatureToggle, dataSource.createEntityManager());
  }

  findByUserId(userId: number): Promise<AdminFeatureToggle[]> {
    return this.find({ where: { userId } });
  }

  findEnabledUserIds(featureKey: string): Promise<AdminFeatureToggle[]> {
    return this.find({ where: { featureKey, enabled: true } });
  }

  async upsertToggle(
    userId: number,
    featureKey: string,
    enabled: boolean,
    updatedBy: number,
  ): Promise<AdminFeatureToggle> {
    const existing = await this.findOne({ where: { userId, featureKey } });
    if (existing) {
      existing.enabled = enabled;
      existing.updatedBy = updatedBy;
      return this.save(existing);
    }
    return this.save(this.create({ userId, featureKey, enabled, updatedBy }));
  }
}
