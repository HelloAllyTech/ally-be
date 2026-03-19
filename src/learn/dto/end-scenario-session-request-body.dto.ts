import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class EndScenarioSessionRequestBodyDto {
  @ApiProperty({
    description: 'Enable recommendations',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  enableRecommendations?: boolean;
}
