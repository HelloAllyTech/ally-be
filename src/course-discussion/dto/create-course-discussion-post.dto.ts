import { IsNotEmpty, IsString } from 'class-validator';

export class CreateCourseDiscussionPostDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}
