import { IsArray, IsOptional, IsString } from 'class-validator';

export class AutoTranslateDto {
  @IsString()
  namespace!: string;

  @IsString()
  key!: string;

  @IsString()
  sourceValue!: string;

  @IsOptional()
  @IsString()
  sourceLanguage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetLanguages?: string[];
}
