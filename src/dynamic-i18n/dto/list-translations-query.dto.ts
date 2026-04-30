import { IsOptional, IsString, Matches } from 'class-validator';

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export class ListTranslationsQueryDto {
  @IsString()
  @Matches(SAFE_SEGMENT)
  language!: string;

  @IsString()
  @Matches(SAFE_SEGMENT)
  namespace!: string;

  @IsOptional()
  @IsString()
  search?: string;
}
