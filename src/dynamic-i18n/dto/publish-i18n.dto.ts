import { IsOptional, IsString } from 'class-validator';

export class PublishI18nDto {
  @IsOptional()
  @IsString()
  note?: string;
}
