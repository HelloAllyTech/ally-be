import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class BehaviorRefDto {
  @ApiProperty({ description: 'ID of the behaviour' })
  id!: string;

  @ApiProperty({ description: 'Name of the behaviour' })
  name!: string;
}

export class SetCompetencyBehavioursDto {
  @ApiProperty({
    type: [String],
    description: 'Free-text helpful behaviours for this competency',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  helpful?: string[];

  @ApiProperty({
    type: [String],
    description: 'Free-text unhelpful behaviours for this competency',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unhelpful?: string[];
}

export class CompetencyBehavioursResponseDto {
  @ApiProperty({ type: [BehaviorRefDto], description: 'Helpful behaviours' })
  helpful!: BehaviorRefDto[];

  @ApiProperty({ type: [BehaviorRefDto], description: 'Unhelpful behaviours' })
  unhelpful!: BehaviorRefDto[];
}
