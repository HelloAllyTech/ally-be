import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TrimStringTransform } from 'src/common/util/string-transform.util';
import { ImageGenerationProviderType } from 'src/image-generation/interface/image-generation-provider.interface';

/**
 * Stateless cover-image generation request: mirrors the scenario form's
 * fields so it works for scenarios that are not saved yet. The prompt itself
 * is a managed template (code `cover_image_generation`, editable via Prompt
 * Management) that these values are substituted into — title/description
 * plus the scenario's persona fields (name, age, gender, profession,
 * currentLocation) for portrait-style covers.
 */
export class GenerateCoverImageRequestDto {
  @ApiProperty({ description: 'Scenario title the cover image is for' })
  @Transform(TrimStringTransform)
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @ApiProperty({ description: 'Scenario description', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ description: 'Scenario persona name', required: false })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ description: 'Scenario persona age', required: false })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(150)
  age?: number;

  @ApiProperty({ description: 'Scenario persona gender', required: false })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(100)
  gender?: string;

  @ApiProperty({
    description: 'Scenario persona profession',
    required: false,
  })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(200)
  profession?: string;

  @ApiProperty({
    description: 'Scenario persona current location',
    required: false,
  })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(300)
  currentLocation?: string;

  @ApiProperty({
    description: 'Optional style guidance substituted into the prompt',
    required: false,
  })
  @IsOptional()
  @Transform(TrimStringTransform)
  @IsString()
  @MaxLength(500)
  styleHints?: string;

  @ApiProperty({
    description: 'Image provider; falls back to the configured default',
    enum: ImageGenerationProviderType,
    required: false,
  })
  @IsOptional()
  @IsEnum(ImageGenerationProviderType)
  provider?: ImageGenerationProviderType;
}

export class GenerateCoverImageResponseDto {
  @ApiProperty({ description: 'Public S3 URL of the generated image' })
  imageUrl!: string;

  @ApiProperty({ description: 'Provider that generated the image' })
  provider!: string;
}
