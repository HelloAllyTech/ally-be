import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SummaryFeedbackContent {
  @ApiProperty({ type: [String], required: false })
  issues?: string[];

  @ApiProperty({ type: String, required: false })
  comment?: string;
}

export class SummaryFeedbackDto {
  @ApiProperty({
    description: 'Numerical rating (e.g. 1-5)',
    example: 5,
    minimum: 1,
    maximum: 5,
    required: true,
  })
  @IsNumber()
  rating!: number;

  @ApiProperty({
    description: 'Feedback on the summary',
    type: SummaryFeedbackContent,
    required: false,
  })
  feedback?: SummaryFeedbackContent;
}
