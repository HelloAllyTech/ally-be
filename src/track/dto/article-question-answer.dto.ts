import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Answering one inline article question. Narrower than `QuizAnswerDto` on
 * purpose — an article question is always a single-select MCQ, so the only
 * thing a learner can send is which option they picked, and the question
 * itself is addressed by the URL.
 */
export class SubmitArticleQuestionAnswerDto {
  @ApiProperty({ description: 'Id of the option the learner chose.' })
  @IsString()
  @IsNotEmpty()
  selectedOptionId!: string;
}
