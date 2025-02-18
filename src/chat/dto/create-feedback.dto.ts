import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isHelpful?: boolean;

  @IsNumber()
  @IsOptional()
  rating?: number;
}
