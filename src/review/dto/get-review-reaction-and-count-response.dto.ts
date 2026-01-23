import { ApiProperty } from '@nestjs/swagger';

export class GetReviewReactionCountResponseDto {
  @ApiProperty({
    example: {
      '1f389': 15,
      '764-fe0f': 8,
    },
    description: 'Object with reaction emoji as key and count as value',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  reactions!: Record<string, number>;
}
