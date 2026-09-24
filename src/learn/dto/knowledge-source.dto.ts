import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class KnowledgeSourceDto {
  @ApiProperty({
    description: 'Knowledge source ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: 'Title of the knowledge source',
    example: 'Knowledge source 1',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Knowledge source content',
    example: 'Knowledge source content',
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiProperty({
    description:
      'Id of the scenario state from which the client may talk about this ' +
      'memory. Until the session reaches that state (or any later one) the ' +
      'content is withheld from the agent and only the title is shown to it, ' +
      'as a topic the client is not ready to discuss. Unset or null means ' +
      'always available. Must name one of the scenario `states`.',
    example: 'state-2',
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  unlocksFromStateId?: string | null;
}
