import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({
    description: 'Room name',
    example: 'ss-123',
  })
  @IsString()
  roomName!: string;

  @ApiProperty({
    description: 'Participant name',
    example: 'John Doe',
  })
  @IsString()
  participantName!: string;

  @ApiProperty({
    description: 'Participant identity',
    example: '123',
  })
  @IsOptional()
  @IsString()
  participantIdentity?: string;
}
