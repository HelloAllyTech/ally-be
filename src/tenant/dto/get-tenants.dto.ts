import { ApiProperty } from '@nestjs/swagger';
import { TenantStatus } from 'src/tenant/entity/tenant.entity';

export class TenantWithUserCountDto {
  @ApiProperty({ example: '1e5a76d2-4b3c-44b5-8af0-4a9b6e593b09' })
  id!: string;

  @ApiProperty({ example: 'Acme Corp' })
  name!: string;

  @ApiProperty({ example: 'ACME' })
  code!: string;

  @ApiProperty({ example: 'A global tech company', required: false })
  description?: string;

  @ApiProperty({ example: 'https://acme.com/logo.png', required: false })
  organizationLogoUrl?: string;

  @ApiProperty({ enum: TenantStatus, example: TenantStatus.ACTIVE })
  status!: TenantStatus;

  @ApiProperty({
    type: Object,
    required: false,
    example: { industry: 'Technology', size: '500+' },
  })
  metadata?: Record<string, any>;

  @ApiProperty({
    type: Object,
    required: false,
    example: { theme: 'dark', region: 'US' },
  })
  settings?: Record<string, any>;

  @ApiProperty({ example: '2025-10-15T12:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2025-10-18T09:00:00.000Z' })
  updatedAt!: Date;

  @ApiProperty({ example: null, required: false })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Number of users associated with this tenant',
    example: 25,
  })
  userCount!: number;

  @ApiProperty({
    description: 'List of enabled dashboard IDs for the tenant',
    type: [String],
    required: false,
    example: ['d1e5a76d-4b3c-44b5-8af0-4a9b6e593b09'],
  })
  enabledDashboardIds!: string[];

  @ApiProperty({
    description: 'Whether rank is hidden in leaderboard',
    example: false,
  })
  hideRankInCommunity!: boolean;

  @ApiProperty({
    description:
      'Whether this is an internal/demo/QA organization excluded from analytics',
    example: false,
  })
  isTestOrganization!: boolean;

  @ApiProperty({
    description: 'Whether audio upload is enabled',
    example: true,
  })
  enableAudioUpload!: boolean;

  @ApiProperty({
    description: 'Whether microphone mode is enabled',
    example: true,
  })
  enableMicrophoneMode!: boolean;
}

export class GetAllTenantsResponseDto {
  @ApiProperty({
    description: 'List of tenants with user count',
    type: TenantWithUserCountDto,
    isArray: true,
  })
  data!: TenantWithUserCountDto[];

  @ApiProperty({
    description: 'Total number of tenants matching the search/filter',
    example: 100,
  })
  count!: number;

  @ApiProperty({
    description: 'Tenant logo URL',
    example: 100,
  })
  LogoUrl?: string;
}
