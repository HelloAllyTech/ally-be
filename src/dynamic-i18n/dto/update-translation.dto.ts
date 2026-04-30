import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

export class UpdateTranslationDto {
  @IsString()
  @Matches(SAFE_SEGMENT)
  language!: string;

  @IsString()
  @Matches(SAFE_SEGMENT)
  namespace!: string;

  @ValidateIf((dto: UpdateTranslationDto) => !dto.changes)
  @IsString()
  @IsNotEmpty()
  key?: string;

  @ValidateIf((dto: UpdateTranslationDto) => !dto.changes)
  @IsString()
  value?: string;

  @IsOptional()
  @IsObject()
  changes?: Record<string, string>;
}
