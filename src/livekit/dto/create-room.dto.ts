import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({
    description: 'Room name',
    example: 'ss-123',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'TTL',
    example: 3600,
  })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(86400)
  ttl?: number;

  @ApiProperty({
    description: 'Max participants',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxParticipants?: number;

  @ApiProperty({
    description: 'Metadata',
    example: {
      userId: 1,
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
