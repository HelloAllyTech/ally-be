import { ApiProperty } from '@nestjs/swagger';

/**
 * GitHub Actions workflow file names backing the ally-mobile automated
 * release pipeline, and the human labels the Mobile Releases admin page
 * shows for each. File names (not numeric workflow ids) are used because
 * GitHub's REST API accepts either interchangeably for these endpoints, and
 * a file name reads sanely in code without a lookup.
 */
export const MOBILE_WORKFLOW_FILES = [
  'scheduled-mobile-release.yml',
  'build-ios-production.yml',
  'build-android-production.yml',
] as const;

export type MobileWorkflowFile = (typeof MOBILE_WORKFLOW_FILES)[number];

export const MOBILE_WORKFLOW_LABELS: Record<MobileWorkflowFile, string> = {
  'scheduled-mobile-release.yml': 'Scheduled Check',
  'build-ios-production.yml': 'iOS Build',
  'build-android-production.yml': 'Android Build',
};

export class MobileReleaseRunDto {
  @ApiProperty({ description: "GitHub's own run id" })
  id!: string;

  @ApiProperty({ enum: Object.values(MOBILE_WORKFLOW_LABELS) })
  workflowName!: string;

  @ApiProperty({ description: 'queued | in_progress | completed' })
  status!: string;

  @ApiProperty({
    nullable: true,
    description: 'null until status is completed',
  })
  conclusion!: string | null;

  @ApiProperty()
  htmlUrl!: string;

  @ApiProperty({ nullable: true })
  actor!: string | null;

  @ApiProperty({ description: 'First 7 characters of the head commit sha' })
  headSha!: string;

  @ApiProperty({ nullable: true })
  headCommitMessage!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ nullable: true })
  runStartedAt!: string | null;
}

export class MobileReleaseRunsResponseDto {
  @ApiProperty({
    type: MobileReleaseRunDto,
    isArray: true,
    description:
      'Runs from all three release workflows, merged and sorted by createdAt descending',
  })
  runs!: MobileReleaseRunDto[];
}

export class MobileAndroidVersionDto {
  @ApiProperty({ nullable: true, description: 'From android/app/build.gradle' })
  versionCode!: number | null;

  @ApiProperty({ nullable: true, description: 'From android/app/build.gradle' })
  versionName!: string | null;
}

export class MobileIosVersionDto {
  @ApiProperty({
    nullable: true,
    description: 'From ios/ally.xcodeproj/project.pbxproj',
  })
  marketingVersion!: string | null;
}

export class MobileCurrentVersionResponseDto {
  @ApiProperty({ type: MobileAndroidVersionDto })
  android!: MobileAndroidVersionDto;

  @ApiProperty({ type: MobileIosVersionDto })
  ios!: MobileIosVersionDto;
}
