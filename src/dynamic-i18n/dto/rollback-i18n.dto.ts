import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RollbackI18nDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
