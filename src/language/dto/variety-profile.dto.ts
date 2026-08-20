import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InferVarietyProfileDto {
  /** tenants.id (as text) whose judged sessions the profile is inferred from. */
  @IsString()
  @MaxLength(255)
  tenantId!: string;

  /** Look-back window over judged sessions; defaults to 90 days. */
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  windowDays?: number;
}
