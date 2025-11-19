import { ApiProperty } from '@nestjs/swagger';

export class ScenarioTenantsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
