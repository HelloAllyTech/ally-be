import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class OzonetelSubscriptionDto {
  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsNotEmpty()
  @IsString()
  tenantId!: string;
}

export class OzonetelUnsubscriptionDto {
  @ApiProperty({
    description: 'Tenant ID',
  })
  @IsNotEmpty()
  @IsString()
  tenantId!: string;
}
