import { IsObject, IsOptional, IsString } from 'class-validator';

export class CiSyncDto {
  @IsObject()
  locales!: Record<string, Record<string, unknown>>;

  @IsOptional()
  @IsString()
  note?: string;
}
