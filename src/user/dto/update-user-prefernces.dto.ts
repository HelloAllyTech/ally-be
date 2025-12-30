import { IsInt, IsOptional } from 'class-validator';

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsInt()
  default_language_id?: number;
}
