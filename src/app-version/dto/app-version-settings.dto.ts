import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

// This is the force-update threshold clients compare their own version string against on
// launch (see the force-update-version-bump runbook) — a malformed value here doesn't just
// fail loudly, it can make that comparison behave unpredictably for every user on the
// platform. X.Y.Z is the only format ally-mobile's build.gradle/pbxproj ever produce, so a
// stricter shape than a free-form string is safe to require at the API boundary.
const VERSION_FORMAT_REGEX = /^\d+\.\d+\.\d+$/;
const VERSION_FORMAT_MESSAGE = 'Version must be in X.Y.Z format (e.g. 1.23.16)';

export class CreateAppVersionSettingsDto {
  @ApiPropertyOptional({
    description: 'iOS minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  @Matches(VERSION_FORMAT_REGEX, { message: VERSION_FORMAT_MESSAGE })
  ios?: string;

  @ApiPropertyOptional({
    description: 'Android minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  @Matches(VERSION_FORMAT_REGEX, { message: VERSION_FORMAT_MESSAGE })
  android?: string;
}

export class UpdateAppVersionSettingsDto {
  @ApiPropertyOptional({
    description: 'iOS minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  @Matches(VERSION_FORMAT_REGEX, { message: VERSION_FORMAT_MESSAGE })
  ios?: string;

  @ApiPropertyOptional({
    description: 'Android minimum supported version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  @Matches(VERSION_FORMAT_REGEX, { message: VERSION_FORMAT_MESSAGE })
  android?: string;
}
