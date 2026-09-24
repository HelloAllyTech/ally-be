import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCourseDiscussionPostDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}
