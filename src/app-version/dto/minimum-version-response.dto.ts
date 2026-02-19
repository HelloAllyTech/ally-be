import { ApiProperty } from '@nestjs/swagger';

export class MinimumVersionResponseDto {
  @ApiProperty({
    description: 'Minimum supported app version (force update threshold)',
    example: '1.2.0',
  })
  minimumSupportedVersion!: string;
}
