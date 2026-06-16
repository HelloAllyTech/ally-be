import { ArrayUnique, IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsInt()
  default_language_id?: number;

  // Ordered list of admin-dashboard sidebar item ids (per-user nav ordering).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  admin_sidebar_order?: string[];
}
