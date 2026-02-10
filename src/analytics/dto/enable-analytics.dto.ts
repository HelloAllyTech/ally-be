import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class EnableAnalyticsDto {
  @ApiProperty({
    description: 'Dashboard IDs to be enabled',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    required: true,
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  dashboardIds!: string[];

  @ApiProperty({
    description: 'Tenant ID to enable these dashboards',
    type: String,
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  @IsString()
  tenantId!: string;
}
