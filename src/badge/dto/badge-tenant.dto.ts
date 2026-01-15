// create dto for request with badgeId and list of tenantIds to assign badges to tenants
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class AddBadgeToTenantsRequestDto {
  @ApiProperty({ description: 'Badge ID' })
  @IsUUID()
  badgeId!: string;

  @ApiProperty({ description: 'List of tenant IDs' })
  @IsArray()
  @IsUUID('4', { each: true })
  tenantIds!: string[];
}
