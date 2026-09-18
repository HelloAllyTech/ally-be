import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Rows accepted in one bulk call.
 *
 * A customer roster is the real payload here — hundreds of numbers arriving as a spreadsheet at
 * onboarding — so this is deliberately higher than BULK_ADD_USERS_MAX (500). Each row is one
 * small insert rather than an account with credits and roles, and the practical ceiling is the
 * global 1 MB `express.json` limit, which a thousand of these rows is nowhere near.
 */
export const BULK_PHONE_MAPPINGS_MAX = 1000;

export class CreateWaPhoneMappingDto {
  @ApiProperty({
    description:
      'The phone number, in any format the admin has it in. Compared on its last 10 digits, ' +
      'so +91 98765 43210 and 919876543210 are the same number.',
    example: '+91 98765 43210',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ description: 'The organisation this number belongs to' })
  @IsUUID('4')
  tenantId!: string;

  @ApiPropertyOptional({
    description:
      "Who this number belongs to, in your words — a name, a role, a ward. The table's only " +
      'human handle: a list of bare numbers cannot be audited six months later.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class UpdateWaPhoneMappingDto {
  @ApiPropertyOptional({
    description: 'Move the number to a different organisation',
  })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class BulkWaPhoneMappingRowDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({
    description:
      'Per-row organisation, for a file that spans several. Falls back to defaultTenantId.',
  })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class BulkWaPhoneMappingsDto {
  @ApiProperty({ type: [BulkWaPhoneMappingRowDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_PHONE_MAPPINGS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BulkWaPhoneMappingRowDto)
  rows!: BulkWaPhoneMappingRowDto[];

  @ApiPropertyOptional({
    description:
      'Applied to every row that names no organisation of its own — the ordinary case, where a ' +
      'whole roster belongs to one customer.',
  })
  @IsOptional()
  @IsUUID('4')
  defaultTenantId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Move numbers that are already mapped to a DIFFERENT organisation. Off by default: a ' +
      'file quietly moving numbers between customers is the kind of thing found out about ' +
      'later, so those rows are reported as conflicts and the admin re-runs deliberately.',
  })
  @IsOptional()
  @IsBoolean()
  overwriteConflicts?: boolean;
}

export class GetWaPhoneMappingsQueryDto {
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Matches the number or the label' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;
}

export class WaPhoneMappingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Digits only, no +' }) phoneE164!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty({ nullable: true }) tenantName!: string | null;
  @ApiProperty({ nullable: true }) label!: string | null;
  @ApiProperty({ nullable: true }) userId!: number | null;
  /**
   * Surfaced rather than resolved silently. The mapping still wins — an admin typed it for this
   * purpose — but "this number maps to Acme and its owner's profile says Beacon" is worth
   * knowing, and it is invisible from anywhere else.
   */
  @ApiProperty({
    nullable: true,
    description:
      "The organisation on the matching user's profile, when it disagrees with this mapping",
  })
  conflictingTenantName!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class GetWaPhoneMappingsResponseDto {
  @ApiProperty({ type: [WaPhoneMappingResponseDto] })
  mappings!: WaPhoneMappingResponseDto[];
  @ApiProperty() count!: number;
}

/** What happened to one row of a bulk upload. */
export type WaPhoneMappingOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'conflict'
  | 'invalid'
  | 'duplicate';

export class BulkWaPhoneMappingResultDto {
  @ApiProperty({ description: '1-based position in the submitted rows' })
  line!: number;
  @ApiProperty() phone!: string;
  @ApiProperty({
    enum: [
      'created',
      'updated',
      'unchanged',
      'conflict',
      'invalid',
      'duplicate',
    ],
  })
  outcome!: WaPhoneMappingOutcome;
  @ApiProperty({
    nullable: true,
    description:
      'Why, for anything other than created/updated — shown against the line',
  })
  reason!: string | null;
}

export class BulkWaPhoneMappingsResponseDto {
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() conflicts!: number;
  @ApiProperty() invalid!: number;
  @ApiProperty() duplicates!: number;
  /**
   * PER-ROW, deliberately unlike POST /users/bulk, which is all-or-nothing.
   *
   * Creating 199 accounts and failing one leaves a mess worth rejecting the batch over. These
   * rows are independent, so one mistyped number in a pasted roster must not throw away the 199
   * good ones — the admin needs to know which lines to fix, not to start again.
   */
  @ApiProperty({ type: [BulkWaPhoneMappingResultDto] })
  results!: BulkWaPhoneMappingResultDto[];
}
