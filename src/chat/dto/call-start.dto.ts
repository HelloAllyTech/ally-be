import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray } from 'class-validator';

export class CallStartDto {
  @ApiProperty({
    description: 'List of participant phone numbers',
    example: ['+1234567890', '+0987654321'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  participantPhoneNumbers: string[] = [];
}
