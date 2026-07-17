import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StartRoleplaySessionDto {
  @ApiPropertyOptional({
    description:
      'Language to run the session in; defaults to the spec version’s language.languageId',
  })
  @IsOptional()
  @IsInt()
  languageId?: number;

  @ApiPropertyOptional({ description: 'LiveKit room TTL (seconds)' })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  ttl?: number;
}

export class StartRoleplaySessionResponseDto {
  @ApiProperty()
  scenarioSession!: Record<string, any>;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  spec!: {
    id: string;
    specVersionId: string;
    title?: string;
    difficulty?: string;
    openingStatement?: string;
  };
}
