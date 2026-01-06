import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateTenantDto {
  @ApiProperty({ description: 'new name for teanant' })
  @IsString()
  @IsOptional()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9\s-_]+$/, {
    message:
      'Name can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  name?: string;

  @ApiProperty({ description: 'new description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Organization URL of the scenario',
    example:
      'https://my-bucket.s3.us-east-1.amazonaws.com/organization-logos/1730000000000-image.jpg',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'Unique code for the tenant' })
  @IsString()
  @Length(2, 20)
  @Matches(/^[a-zA-Z0-9-_]+$/, {
    message: 'Code can only contain letters, numbers, hyphens, and underscores',
  })
  @IsOptional()
  code?: string;
}
