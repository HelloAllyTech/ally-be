import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { SuccessResponse } from 'src/common/type/common.type';
import { TrackTenant } from '../entity/track-tenant.entity';

@Injectable()
export class TrackTenantRepository extends Repository<TrackTenant> {
  constructor(private dataSource: DataSource) {
    super(TrackTenant, dataSource.createEntityManager());
  }

  async createTrackTenants(
    trackTenants: Array<{ trackId: string; tenantId: string }>,
  ): Promise<SuccessResponse> {
    await this.save(this.create(trackTenants));
    return { success: true };
  }

  async deleteByTrackIds(
    trackIds: string[],
    tenantId: string,
  ): Promise<SuccessResponse> {
    const result = await this.delete({ tenantId, trackId: In(trackIds) });
    return { success: result.affected !== 0 };
  }

  async getTrackTenants(
    trackIds: string[],
    tenantId: string,
  ): Promise<TrackTenant[]> {
    return this.find({ where: { tenantId, trackId: In(trackIds) } });
  }
}
