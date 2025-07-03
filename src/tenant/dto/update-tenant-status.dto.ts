import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TenantStatus } from '../../common/entities/tenant.entity';

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TenantStatus, description: 'New status for the tenant' })
  @IsEnum(TenantStatus)
  status!: TenantStatus;
}
