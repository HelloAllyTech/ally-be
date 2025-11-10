import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class GetChatTypesDto {
  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class UpdateChatTypesDto {
  @ApiProperty({
    description: 'Hidden chat types',
  })
  @IsArray()
  @IsString({ each: true })
  hiddenChatTypes!: string[];

  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsUUID()
  tenantId!: string;
}
