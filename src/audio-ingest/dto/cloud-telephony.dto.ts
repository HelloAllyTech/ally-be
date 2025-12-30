import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
import { CloudTelephonyProvider } from '../../common/constants/chat.constants';

export class CreateCloudTelephonyIntegrationDto {
  @ApiProperty({
    description: 'The provider of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsString()
  provider!: CloudTelephonyProvider;

  @ApiProperty({
    description: 'The credentials of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsObject()
  credentials!: Record<string, any>;

  @ApiProperty({
    description: 'The code of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(16)
  code!: string;

  @ApiProperty({
    description: 'The tenant id of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsString()
  tenantId!: string;
}

export class CloudTelephonyIntegrationResponseDto {
  @ApiProperty({
    description: 'The id of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'The provider of the cloud telephony integration',
  })
  @IsNotEmpty()
  @IsString()
  provider!: CloudTelephonyProvider;
}
