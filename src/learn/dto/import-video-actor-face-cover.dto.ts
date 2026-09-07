import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { VideoActorProvider } from '../enum/video-actor-provider.enum';

export class ImportVideoActorFaceCoverDto {
  @ApiProperty({
    description:
      'Which vendor the face belongs to. A face id is only meaningful against its own vendor.',
    enum: VideoActorProvider,
    example: VideoActorProvider.TAVUS,
  })
  @IsEnum(VideoActorProvider)
  provider!: VideoActorProvider;

  @ApiProperty({
    description:
      "The face id to copy preview media from. Must be one of the vendor's currently selectable faces — validated against the live catalogue rather than trusted, so this cannot be used to make the server fetch an arbitrary URL.",
    example: 'ra066ab28864',
  })
  @IsString()
  @IsNotEmpty()
  faceId!: string;
}
