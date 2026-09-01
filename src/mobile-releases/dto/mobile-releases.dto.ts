import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  'submit-ios-app-store-review.yml',
] as const;

export type MobileWorkflowFile = (typeof MOBILE_WORKFLOW_FILES)[number];

export const MOBILE_WORKFLOW_LABELS: Record<MobileWorkflowFile, string> = {
  'scheduled-mobile-release.yml': 'Scheduled Check',
  'build-ios-production.yml': 'iOS Build',
  'build-android-production.yml': 'Android Build',
  'promote-android-production.yml': 'Promote Android',
  'submit-ios-app-store-review.yml': 'App Store Review Submission',
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
 * Reused as-is for every other workflow-dispatch endpoint in this module
 * (promote-android, submit-ios-app-store-review, and formerly
 * promote-ios-testflight): shape is identical to MobileTriggerResponseDto
 * ({ dispatched: true }), but named generically here since "trigger"
 * specifically refers to scheduled-mobile-release.yml elsewhere in this
 * module.
 */
export class MobileDispatchResponseDto {
  @ApiProperty({
    description:
      'true once the target workflow has been dispatched via the GitHub API',
  })
  dispatched!: boolean;
}

export class IosTestflightStatusResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'App Store Connect build version of the latest VALID (fully processed) ' +
      'build for com.helloally.app. null if no processed build exists yet ' +
      '(e.g. still processing, or none uploaded).',
  })
  buildVersion!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "App Store Connect's own id for that build. null alongside buildVersion.",
  })
  buildId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "Apple's raw betaReviewState enum value from betaAppReviewSubmissions " +
      '(WAITING_FOR_REVIEW | IN_REVIEW | REJECTED | APPROVED), passed through ' +
      'verbatim rather than remapped. null if the build has never been ' +
      'submitted for Beta App Review — App Store Connect shows this state as ' +
      '"Ready to Submit". Also null when buildId is null.',
  })
  betaReviewState!: string | null;

  @ApiProperty({
    description:
      'true if the build is associated with the beta group named by the ' +
      'TESTFLIGHT_EXTERNAL_GROUP_NAME config value. false (never null) when ' +
      'there is no processed build, or no group matches.',
  })
  externalGroupAssigned!: boolean;
}

export class IosTestflightHistoryEntryDto {
  @ApiProperty({ description: 'App Store Connect build version' })
  buildVersion!: string;

  @ApiProperty({ description: "App Store Connect's own id for this build" })
  buildId!: string;

  @ApiProperty({
    description: "ISO timestamp, from Apple's build attributes.uploadedDate",
  })
  uploadedDate!: string;

  @ApiProperty({
    nullable: true,
    description:
      "Apple's raw betaReviewState enum value from betaAppReviewSubmissions " +
      '(WAITING_FOR_REVIEW | IN_REVIEW | REJECTED | APPROVED), passed through ' +
      'verbatim rather than remapped. null if this build has never been ' +
      'submitted for Beta App Review.',
  })
  betaReviewState!: string | null;
}

export class IosTestflightHistoryResponseDto {
  @ApiProperty({
    type: IosTestflightHistoryEntryDto,
    isArray: true,
    description:
      'Up to the last 15 processed (VALID) iOS builds for com.helloally.app, ' +
      'each with its Beta App Review submission status, sorted by ' +
      'uploadedDate descending. Empty array if no processed build exists yet.',
  })
  history!: IosTestflightHistoryEntryDto[];
}

export class IosAppStoreReviewSubmissionEntryDto {
  @ApiProperty({
    description:
      'App Store version string this submission covers (e.g. "1.23.15"), ' +
      "resolved from Apple's appStoreVersionForReview relationship.",
  })
  versionString!: string;

  @ApiProperty({
    description:
      "ISO timestamp, from Apple's reviewSubmissions attributes.submittedDate",
  })
  submittedDate!: string;

  @ApiProperty({
    description:
      "Apple's raw reviewSubmissions state enum value (READY_FOR_REVIEW | " +
      'WAITING_FOR_REVIEW | IN_REVIEW | UNRESOLVED_ISSUES | CANCELING | ' +
      'COMPLETING | COMPLETE), passed through verbatim rather than remapped — ' +
      'same convention as betaReviewState elsewhere in this module.',
  })
  state!: string;
}

export class IosAppStoreReviewSubmissionsResponseDto {
  @ApiProperty({
    type: IosAppStoreReviewSubmissionEntryDto,
    isArray: true,
    description:
      "Up to the last 15 of Apple's full App Store review submissions for " +
      'com.helloally.app, sorted by submittedDate descending. Distinct from ' +
      'the TestFlight Beta App Review history above — these are submissions ' +
      'for real public App Store distribution, from the reviewSubmissions ' +
      'resource, not betaAppReviewSubmissions. Empty array if none exist yet.',
  })
  submissions!: IosAppStoreReviewSubmissionEntryDto[];
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

  @ApiProperty({
    required: false,
    description:
      'Optional "What\'s New" text for the production listing. Google Play doesn\'t carry a ' +
      "release's notes across tracks automatically, so without this the production listing " +
      "ends up with none at all. Forwarded to promote-android-production.yml's whats_new input.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000) // generous sanity cap; Play Store's own field limit applies and rejects via the usual error path if exceeded
  whatsNew?: string;
}

export class IosWhatsNewSuggestionResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'LLM-drafted "What\'s New in This Version" text, generated from ' +
      'ally-mobile commit subjects since the last release (the most recent ' +
      'commit that touched android/app/build.gradle on master), with ' +
      '"Merge pull request" commits filtered out. Meant to prefill the App ' +
      "Store submission's What's New field — still editable, never " +
      'auto-submitted. null when there are no new (non-merge) commits since ' +
      'the last release to summarize, which is a normal state, not an error.',
  })
  suggestion!: string | null;
}

export class SubmitIosAppStoreReviewRequestDto {
  @ApiProperty({
    required: false,
    description:
      "Optional replacement text for the App Store listing's \"What's New in This Version\" field, applied before submission. Forwarded to submit-ios-app-store-review.yml's whats_new input. Omit to leave whatever is already set in App Store Connect untouched.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000) // generous sanity cap; Apple's own field limit applies and rejects via the usual error path if exceeded
  whatsNew?: string;
}
