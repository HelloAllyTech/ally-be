import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLabValueDto {
  @ApiProperty({ description: 'The variable this value is bound to' })
  @IsUUID()
  variableId!: string;

  @ApiPropertyOptional({ description: 'Optional friendly label for the value' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'The substitution value' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class UpdateLabValueDto {
  @ApiPropertyOptional({
    description: 'Reassign the value to a different variable',
  })
  @IsOptional()
  @IsUUID()
  variableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  value?: string;
}
