import { ApiProperty } from '@nestjs/swagger';
import { AddUserResponseDto } from './user-add-response.dto';

export class BulkAddUsersResponseDto {
  @ApiProperty({ description: 'Number of users created' })
  created!: number;

  @ApiProperty({
    description: 'The users created in this batch',
    type: [AddUserResponseDto],
  })
  users!: AddUserResponseDto[];
}
