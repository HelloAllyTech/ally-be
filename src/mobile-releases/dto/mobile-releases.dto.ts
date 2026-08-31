import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

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
  'promote-android-production.yml',
  'promote-ios-testflight-external.yml',
] as const;

export type MobileWorkflowFile = (typeof MOBILE_WORKFLOW_FILES)[number];

export const MOBILE_WORKFLOW_LABELS: Record<MobileWorkflowFile, string> = {
  'scheduled-mobile-release.yml': 'Scheduled Check',
  'build-ios-production.yml': 'iOS Build',
  'build-android-production.yml': 'Android Build',
  'promote-android-production.yml': 'Promote Android',
  'promote-ios-testflight-external.yml': 'Promote iOS External',
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

  @ApiProperty({
    nullable: true,
    description:
      'Estimated ISO timestamp of the next daily 05:00 UTC tick at which ' +
      'scheduled-mobile-release.yml is eligible to ship (48h+ since the ' +
      'last android/app/build.gradle version bump). An estimate only: the ' +
      'workflow still requires new commits on master and green tests at ' +
      'that tick, neither of which this endpoint can know in advance. ' +
      'null if the version-bump history could not be read.',
  })
  nextEligibleCheckAt!: string | null;
}

export class MobileTriggerResponseDto {
  @ApiProperty({
    description:
      'true once scheduled-mobile-release.yml has been dispatched via the GitHub API',
  })
  dispatched!: boolean;
}

/**
 * Reused as-is for both promote-android and promote-ios-testflight: shape is
 * identical to MobileTriggerResponseDto ({ dispatched: true }), but named
 * generically here since "trigger" specifically refers to
 * scheduled-mobile-release.yml elsewhere in this module.
 */
export class MobileDispatchResponseDto {
  @ApiProperty({
    description:
      'true once the target workflow has been dispatched via the GitHub API',
  })
  dispatched!: boolean;
}

export class PromoteAndroidRequestDto {
  @ApiProperty({
    minimum: 1,
    maximum: 100,
    description:
      "Play Store staged rollout percentage to promote the production track to, e.g. 20 for 20%. Forwarded to promote-android-production.yml's rollout_percentage input as a string, per GitHub's workflow_dispatch requirements.",
  })
  @IsInt()
  @Min(1)
  @Max(100)
  rolloutPercentage!: number;
}
