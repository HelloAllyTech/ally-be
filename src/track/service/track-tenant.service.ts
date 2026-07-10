import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SuccessResponse } from 'src/common/type/common.type';
import { TenantService } from 'src/tenant/service/tenant.service';
import { In } from 'typeorm';
import { TrackRepository } from '../repository/track.repository';
import { TrackTenantRepository } from '../repository/track-tenant.repository';
import {
  CreateTrackTenantDto,
  DeleteTrackTenantDto,
} from '../dto/track-tenant.dto';

@Injectable()
export class TrackTenantService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly trackTenantRepository: TrackTenantRepository,
    private readonly tenantService: TenantService,
  ) {}

  async assignTracksToTenant(
    tenantId: string,
    dto: CreateTrackTenantDto,
  ): Promise<SuccessResponse> {
    await this.validateTrackTenant(dto.trackIds, tenantId);
    const existing = await this.trackTenantRepository.getTrackTenants(
      dto.trackIds,
      tenantId,
    );
    if (existing.length > 0) {
      throw new ConflictException('Track-tenant mapping is already present');
    }
    return this.trackTenantRepository.createTrackTenants(
      dto.trackIds.map((trackId) => ({ trackId, tenantId })),
    );
  }

  async removeTracksFromTenant(
    tenantId: string,
    dto: DeleteTrackTenantDto,
  ): Promise<SuccessResponse> {
    await this.validateTrackTenant(dto.trackIds, tenantId);
    const existing = await this.trackTenantRepository.getTrackTenants(
      dto.trackIds,
      tenantId,
    );
    if (existing.length === 0) {
      throw new NotFoundException('No valid track-tenant found');
    }
    return this.trackTenantRepository.deleteByTrackIds(dto.trackIds, tenantId);
  }

  private async validateTrackTenant(
    trackIds: string[],
    tenantId: string,
  ): Promise<void> {
    const tenant = await this.tenantService.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    const tracks = await this.trackRepository.find({
      where: { id: In(trackIds) },
    });
    if (tracks.length !== trackIds.length) {
      const foundIds = new Set(tracks.map((t) => t.id));
      const missing = trackIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Tracks not found: ${missing.join(', ')}`);
    }
  }
}
