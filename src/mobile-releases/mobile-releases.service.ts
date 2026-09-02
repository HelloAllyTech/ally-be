import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import { google } from 'googleapis';
import * as jwt from 'jsonwebtoken';
import { AppVersionSettingsService } from 'src/app-version/service/app-version-settings.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { SlackService } from 'src/notification/service/slack.service';
import { MobileReleaseWhatsNewAiService } from './mobile-release-whats-new-ai.service';
import {
  AndroidProductionStatusResponseDto,
  IosAppStoreReviewSubmissionEntryDto,
  IosAppStoreReviewSubmissionsResponseDto,
  IosTestflightHistoryEntryDto,
  IosTestflightHistoryResponseDto,
  IosTestflightStatusResponseDto,
  IosWhatsNewSuggestionResponseDto,
  MOBILE_WORKFLOW_FILES,
  MOBILE_WORKFLOW_LABELS,
  MobileCurrentVersionResponseDto,
  MobileDispatchResponseDto,
  MobileReleaseRunDto,
  MobileTriggerResponseDto,
  MobileWorkflowFile,
} from './dto/mobile-releases.dto';

const GITHUB_API = 'https://api.github.com';
const RELEASE_WORKFLOW_FILE: MobileWorkflowFile =
  'scheduled-mobile-release.yml';
const PROMOTE_ANDROID_WORKFLOW_FILE: MobileWorkflowFile =
  'promote-android-production.yml';
const SUBMIT_IOS_APP_STORE_REVIEW_WORKFLOW_FILE: MobileWorkflowFile =
  'submit-ios-app-store-review.yml';
const MS_PER_HOUR = 60 * 60 * 1000;
const CADENCE_GATE_HOURS = 48;
const DAILY_CHECK_UTC_HOUR = 5; // matches scheduled-mobile-release.yml's `cron: '0 5 * * *'`

const APPSTORE_CONNECT_API = 'https://api.appstoreconnect.apple.com/v1';
const APPSTORE_BUNDLE_ID = 'com.helloally.app';
const APPSTORE_JWT_AUDIENCE = 'appstoreconnect-v1';
// Apple caps App Store Connect API JWTs at 20 minutes; stay comfortably under it.
const APPSTORE_JWT_TTL_SECONDS = 19 * 60;
const TESTFLIGHT_HISTORY_BUILD_LIMIT = 15;
const APP_STORE_REVIEW_SUBMISSION_LIMIT = 15;

const ANDROID_PACKAGE_NAME = 'com.helloally.app';

/**
 * Normalizes an APPSTORE_API_PRIVATE_KEY env value into a clean PEM string,
 * mirroring ally-mobile's scripts/promote-ios-testflight.mjs exactly — every
 * step here is the product of live production debugging, not speculation.
 */
function normalizeAppStoreConnectPrivateKey(raw: string): string {
  // Accept either raw PEM or base64-encoded PEM. Checking for "PRIVATE KEY"
  // (not "BEGIN PRIVATE KEY") so this also matches SEC1-format keys headed
  // "-----BEGIN EC PRIVATE KEY-----". gitleaks:allow
  let key = raw.includes('PRIVATE KEY')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf-8');
  // A literal "\n" (backslash-n) instead of a real newline is a common
  // secret-storage flattening artifact.
  key = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  // CRLF line endings parse fine by eye but can trip OpenSSL's PEM decoder.
  key = key.replace(/\r/g, '');
  key = key.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  // CONFIRMED root cause on a real key tonight: a trailing "%" is zsh's own
  // "no trailing newline" indicator, left over from someone copying a
  // `cat file.p8` terminal display instead of the file's raw bytes. No valid
  // PEM ever legitimately ends in "%".
  if (key.endsWith('%')) {
    key = key.slice(0, -1).trimEnd();
  }
  return key;
}

// Known PEM private-key header/footer pairs, checked by exact string match. Reporting only
// which candidate index matched (a number), plus per-line character codes, keeps a parse-failure
// error diagnosable without ever including a substring of the actual secret in the response —
// same defensive shape ally-mobile's promote-ios-testflight.mjs converged on after discovering
// GitHub Actions masks every line of a multi-line secret independently, which made an earlier,
// more naive version of this diagnostic (printing the matched header/footer text directly) come
// back redacted as "***" in a real run. HTTP responses aren't subject to that same masking, but
// there's no reason to print key-derived substrings here either.
//
// The `gitleaks:allow` trailers below are required, not cosmetic: gitleaks' private-key
// rule fires on a bare BEGIN/END marker, so these format constants turned master's
// secret-scan red. Per-line annotation is deliberate over a config allowlist — three
// allowlist spellings (path-scoped, ^...$ anchors, \A...\z anchors) were each tested by
// generating a real EC key into this file, and all three suppressed THAT too. gitleaks
// ORs `paths` with `regexes`, and its anchors match per line, so a config entry narrow
// enough to describe "marker with no body" could not be written. These annotations only
// silence the exact lines they sit on; a pasted key elsewhere in this file still fails CI.
const KNOWN_PEM_HEADERS = [
  '-----BEGIN PRIVATE KEY-----', // PKCS8 — what App Store Connect's .p8 download normally is gitleaks:allow
  '-----BEGIN EC PRIVATE KEY-----', // SEC1 gitleaks:allow
  '-----BEGIN RSA PRIVATE KEY-----', // wrong key type entirely gitleaks:allow
  '-----BEGIN ENCRYPTED PRIVATE KEY-----', // password-protected — unsupported here, no passphrase is ever provided gitleaks:allow
];
const KNOWN_PEM_FOOTERS = [
  '-----END PRIVATE KEY-----', // gitleaks:allow
  '-----END EC PRIVATE KEY-----', // gitleaks:allow
  '-----END RSA PRIVATE KEY-----', // gitleaks:allow
  '-----END ENCRYPTED PRIVATE KEY-----', // gitleaks:allow
];

function describePemShape(pem: string): string {
  const lines = pem.split('\n');
  const headerIndex = KNOWN_PEM_HEADERS.findIndex((h) => pem.startsWith(h));
  const trimmedEnd = pem.trimEnd();
  const footerIndex = KNOWN_PEM_FOOTERS.findIndex((f) =>
    trimmedEnd.endsWith(f),
  );
  const firstLineCharCodes = [...(lines[0] ?? '')].map((c) => c.charCodeAt(0));
  const lastLine = lines[lines.length - 1] ?? '';
  const lastLineCharCodes = [...lastLine].map((c) => c.charCodeAt(0));
  return (
    `total length ${pem.length}, ${lines.length} line(s) (lengths: ${lines
      .map((l) => l.length)
      .join(',')}), header candidate index: ${headerIndex} (-1 = no known ` +
    `header matched), footer candidate index: ${footerIndex} (-1 = no known ` +
    `footer matched), first line char codes: [${firstLineCharCodes.join(',')}], ` +
    `last line char codes: [${lastLineCharCodes.join(',')}]`
  );
}

/**
 * A Build's own `attributes.version` is Apple's CFBundleVersion — for this app that's the
 * timestamp-based build number build-ios-production.yml generates (e.g. "1202608310934"), not
 * the human-meaningful marketing version ("1.23.15") shown everywhere else on the admin page.
 * That marketing version lives on a separate PrereleaseVersion resource, reachable from the
 * build via `relationships.preReleaseVersion` — fetched alongside the build in the same request
 * via `include=preReleaseVersion` rather than a second round-trip per build. Falls back to the
 * raw build number if the pre-release version can't be resolved for some reason, so the caller
 * always gets *something* rather than an empty string.
 */
function resolveMarketingVersion(build: any, included: any[]): string {
  const preReleaseVersionId = build?.relationships?.preReleaseVersion?.data?.id;
  const preReleaseVersion = (included ?? []).find(
    (item: any) =>
      item?.type === 'preReleaseVersions' && item?.id === preReleaseVersionId,
  );
  const marketingVersion = preReleaseVersion?.attributes?.version;
  return marketingVersion
    ? String(marketingVersion)
    : String(build?.attributes?.version ?? '');
}

/**
 * Straight passthrough to GitHub's REST API for the ally-mobile release
 * pipeline — no caching, per the same reasoning as the AWS Logs viewer:
 * GitHub's own rate limits are generous for a low-traffic admin page, and a
 * TTL cache here would be premature.
 */
@Injectable()
export class MobileReleasesService {
  private readonly logger = LoggerService.getInstance(
    MobileReleasesService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly whatsNewAiService: MobileReleaseWhatsNewAiService,
    private readonly appVersionSettingsService: AppVersionSettingsService,
    private readonly slackService: SlackService,
  ) {}

  private get repo(): string {
    return this.configService.githubMobileRepo;
  }

  /** Throws when GITHUB_ACTIONS_TOKEN is unset — every caller must refuse cleanly rather than call GitHub with no auth. */
  private requireToken(): string {
    const token = this.configService.githubActionsToken;
    if (!token) {
      throw new ServiceUnavailableException(
        'GITHUB_ACTIONS_TOKEN is not configured on this environment, so mobile release status cannot be read.',
      );
    }
    return token;
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.requireToken()}`,
    };
  }

  /**
   * Recent runs of all three release workflows, merged into one array and
   * sorted by createdAt descending.
   *
   * Uses allSettled, not all: this is polled every 30s from the admin page,
   * and GitHub's REST API occasionally throws a transient secondary-rate-limit
   * 403 on one of the three parallel per-workflow calls. With Promise.all,
   * that one flaky call used to fail the whole merged list — which the
   * frontend's polling then rendered as a "Failed to load run history"
   * screen replacing an otherwise-healthy table every time it happened. A
   * partial result (the workflows that did succeed) is far more useful than
   * none, so a single workflow's failure is logged and dropped rather than
   * taking down the other two.
   */
  async listRuns(): Promise<MobileReleaseRunDto[]> {
    const headers = this.headers;

    const settled = await Promise.allSettled(
      MOBILE_WORKFLOW_FILES.map((file) =>
        this.fetchWorkflowRuns(file, headers),
      ),
    );

    const runsPerWorkflow = settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      this.logger.warn(
        `Dropping runs for ${MOBILE_WORKFLOW_FILES[index]} from listRuns(): ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`,
      );
      return [];
    });

    return runsPerWorkflow
      .flat()
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  private async fetchWorkflowRuns(
    file: MobileWorkflowFile,
    headers: Record<string, string>,
  ): Promise<MobileReleaseRunDto[]> {
    try {
      const { data } = await axios.get(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${file}/runs`,
        { headers, params: { per_page: 15 }, timeout: 15_000 },
      );
      return (data?.workflow_runs ?? []).map((run: any) =>
        this.toRunDto(file, run),
      );
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not list runs for ${file} in ${this.repo}`,
      );
    }
  }

  private toRunDto(file: MobileWorkflowFile, run: any): MobileReleaseRunDto {
    const headCommitMessage: string | null = run?.head_commit?.message
      ? String(run.head_commit.message).split('\n')[0]
      : null;

    return {
      id: String(run?.id ?? ''),
      workflowName: MOBILE_WORKFLOW_LABELS[file],
      status: String(run?.status ?? ''),
      conclusion: run?.conclusion ?? null,
      htmlUrl: run?.html_url ? String(run.html_url) : '',
      actor: run?.actor?.login ? String(run.actor.login) : null,
      headSha: run?.head_sha ? String(run.head_sha).slice(0, 7) : '',
      headCommitMessage,
      createdAt: run?.created_at ? String(run.created_at) : '',
      updatedAt: run?.updated_at ? String(run.updated_at) : '',
      runStartedAt: run?.run_started_at ? String(run.run_started_at) : null,
    };
  }

  /**
   * Live version info from `master` — android/app/build.gradle's versionCode
   * + versionName, and ios/ally.xcodeproj/project.pbxproj's first
   * MARKETING_VERSION. Regex-extracted rather than parsed: both files are
   * not valid JSON/YAML, and the pipeline only ever needs these few fields.
   *
   * Also includes `nextEligibleCheckAt`, a best-effort ETA for the next
   * scheduled-mobile-release.yml run that could actually ship a build. That
   * sub-fetch is allowed to fail independently — it's a nice-to-have, not
   * the reason this endpoint exists.
   */
  async getCurrentVersion(): Promise<MobileCurrentVersionResponseDto> {
    const headers = this.headers;

    const [android, pbxproj, nextEligibleCheckAt] = await Promise.all([
      this.fetchCurrentAndroidVersion(headers),
      this.fetchFileContent('ios/ally.xcodeproj/project.pbxproj', headers),
      this.computeNextEligibleCheckAt(headers),
    ]);

    const marketingVersionMatch = pbxproj.match(
      /MARKETING_VERSION\s*=\s*([^;]+);/,
    );

    return {
      android,
      ios: {
        marketingVersion: marketingVersionMatch
          ? marketingVersionMatch[1].trim()
          : null,
      },
      nextEligibleCheckAt,
    };
  }

  /** Regex-extracted from master's android/app/build.gradle — shared by getCurrentVersion() and the Android auto-bump task below. */
  private async fetchCurrentAndroidVersion(
    headers: Record<string, string>,
  ): Promise<{ versionCode: number | null; versionName: string | null }> {
    const gradle = await this.fetchFileContent(
      'android/app/build.gradle',
      headers,
    );
    const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
    const versionNameMatch = gradle.match(/versionName\s+"([^"]+)"/);
    return {
      versionCode: versionCodeMatch ? Number(versionCodeMatch[1]) : null,
      versionName: versionNameMatch ? versionNameMatch[1] : null,
    };
  }

  /**
   * LLM-drafted "What's New in This Version" text for the App Store
   * submission, built from the ally-mobile commit subjects since the last
   * release point (the same "most recent commit that touched
   * android/app/build.gradle on master" heuristic computeNextEligibleCheckAt
   * uses). Read-only and uncached — a fresh suggestion each time is correct
   * here since the commit history changes.
   *
   * Zero non-merge commits since the last release point is a legitimate
   * "nothing new" state, not an error: returns `{ suggestion: null }` rather
   * than calling the model or throwing.
   */
  async getIosWhatsNewSuggestion(): Promise<IosWhatsNewSuggestionResponseDto> {
    const headers = this.headers;
    const commitSubjects =
      await this.fetchCommitSubjectsSinceLastRelease(headers);

    if (commitSubjects.length === 0) {
      return { suggestion: null };
    }

    const suggestion =
      await this.whatsNewAiService.generateSuggestion(commitSubjects);
    return { suggestion };
  }

  /**
   * Non-merge commit subject lines (first line of each commit message) on
   * `master` since the last release point, oldest-first as GitHub's compare
   * API returns them. "Merge pull request" commits are filtered out — the
   * same convention ally-mobile's scheduled-mobile-release.yml already uses
   * when building Android release notes.
   */
  private async fetchCommitSubjectsSinceLastRelease(
    headers: Record<string, string>,
  ): Promise<string[]> {
    const lastReleaseSha = await this.fetchLastReleaseCommitSha(headers);

    try {
      const { data } = await axios.get(
        `${GITHUB_API}/repos/${this.repo}/compare/${lastReleaseSha}...master`,
        { headers, timeout: 15_000 },
      );
      const commits = data?.commits ?? [];
      return commits
        .map((commit: any) =>
          String(commit?.commit?.message ?? '')
            .split('\n')[0]
            .trim(),
        )
        .filter(
          (subject: string) =>
            subject && !subject.startsWith('Merge pull request'),
        );
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not compare ${lastReleaseSha}...master for ${this.repo}`,
      );
    }
  }

  /**
   * SHA of the most recent commit that touched android/app/build.gradle on
   * master — same GitHub API call shape as computeNextEligibleCheckAt below
   * (that method only needs the commit's date; this one needs its sha), used
   * here as "the last release point" to diff master against.
   */
  private async fetchLastReleaseCommitSha(
    headers: Record<string, string>,
  ): Promise<string> {
    try {
      const { data } = await axios.get(
        `${GITHUB_API}/repos/${this.repo}/commits`,
        {
          headers,
          params: {
            path: 'android/app/build.gradle',
            sha: 'master',
            per_page: 1,
          },
          timeout: 15_000,
        },
      );
      const sha = data?.[0]?.sha;
      if (!sha) {
        throw new Error(
          'No commits found for android/app/build.gradle on master',
        );
      }
      return String(sha);
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not find the last release commit for ${this.repo}`,
      );
    }
  }

  /**
   * ESTIMATE only, not a guarantee. scheduled-mobile-release.yml ships a
   * build once 48h+ have passed since the last version bump AND there are
   * new commits on master AND tests are green when its daily 05:00 UTC
   * cron tick fires — this method can only account for the 48h cadence
   * gate and the cron cadence, since "are there new commits" and "are
   * tests green" are unknowable in advance.
   *
   * "Last version bump" is approximated as the most recent commit that
   * touched android/app/build.gradle on master, which changes whenever a
   * release actually lands (automated or, historically, manual).
   *
   * Returns null (rather than throwing) if that history can't be read, so
   * a GitHub hiccup here never takes down the primary version payload.
   */
  private async computeNextEligibleCheckAt(
    headers: Record<string, string>,
  ): Promise<string | null> {
    try {
      const { data } = await axios.get(
        `${GITHUB_API}/repos/${this.repo}/commits`,
        {
          headers,
          params: {
            path: 'android/app/build.gradle',
            sha: 'master',
            per_page: 1,
          },
          timeout: 15_000,
        },
      );

      const commit = data?.[0]?.commit;
      const lastVersionBumpAt: string | undefined =
        commit?.committer?.date ?? commit?.author?.date;
      if (!lastVersionBumpAt) {
        return null;
      }

      const eligibleAt = new Date(
        new Date(lastVersionBumpAt).getTime() +
          CADENCE_GATE_HOURS * MS_PER_HOUR,
      );
      const now = new Date();
      const referencePoint =
        eligibleAt.getTime() > now.getTime() ? eligibleAt : now;

      return this.firstDailyCheckAtOrAfter(referencePoint).toISOString();
    } catch (error) {
      this.logger.warn(
        `Could not compute nextEligibleCheckAt for ${this.repo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** First scheduled-mobile-release.yml cron tick (05:00 UTC daily) at or after `from`. */
  private firstDailyCheckAtOrAfter(from: Date): Date {
    const tick = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate(),
        DAILY_CHECK_UTC_HOUR,
        0,
        0,
        0,
      ),
    );
    if (tick.getTime() < from.getTime()) {
      tick.setUTCDate(tick.getUTCDate() + 1);
    }
    return tick;
  }

  /**
   * Manually dispatches scheduled-mobile-release.yml with `force: 'true'`,
   * which skips the 48h cadence gate but still requires green tests before
   * anything ships — safe to call anytime.
   *
   * DEPLOYMENT PREREQUISITE: dispatching a workflow requires `Actions: write`
   * scope on the GitHub token, but GITHUB_ACTIONS_TOKEN was originally
   * provisioned read-only (`Actions: read` + `Contents: read`) for
   * listRuns()/getCurrentVersion(). That token must be upgraded to
   * `Actions: read and write` in GitHub's PAT settings for this endpoint to
   * work — this is not fixable in code. A 403 or 404 from GitHub here is the
   * likely symptom of a still-read-only token.
   */
  async triggerRelease(): Promise<MobileTriggerResponseDto> {
    const headers = this.headers;

    try {
      // GitHub returns 204 No Content with an empty body on success — do not
      // attempt to read/parse `data` from this response.
      await axios.post(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${RELEASE_WORKFLOW_FILE}/dispatches`,
        { ref: 'master', inputs: { force: 'true' } },
        { headers, timeout: 15_000 },
      );
      return { dispatched: true };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not dispatch ${RELEASE_WORKFLOW_FILE} on ${this.repo}`,
      );
    }
  }

  /**
   * MANUAL, REAL-PRODUCTION ACTION. Dispatches promote-android-production.yml,
   * which advances the Play Store production track's staged rollout to
   * `rolloutPercentage`% — this is workflow_dispatch-only, never runs
   * automatically, and there is no undo endpoint here (rollout percentage
   * can only go up via this workflow; a halt/rollback is a Play Console
   * action, not a GitHub Actions one).
   *
   * DEPLOYMENT PREREQUISITE: the Play Console service account backing this
   * workflow's Google Play upload step must be granted "Release to
   * production" permission in Play Console — today it may only be scoped to
   * internal-track release, in which case this workflow will fail even
   * though the GitHub dispatch itself succeeds. That's a Play Console
   * change, not something fixable here.
   *
   * `whatsNew`, when provided, sets the production release's "What's New"
   * text — Google Play does not carry a release's notes across tracks
   * automatically, so without this the production listing ends up with none
   * at all even though the internal track has its own. Omitted (or left
   * empty), the production release just has no release notes, same as
   * before this parameter existed.
   */
  async promoteAndroid(
    rolloutPercentage: number,
    whatsNew?: string,
  ): Promise<MobileDispatchResponseDto> {
    const headers = this.headers;

    try {
      // GitHub returns 204 No Content with an empty body on success — do not
      // attempt to read/parse `data` from this response.
      await axios.post(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${PROMOTE_ANDROID_WORKFLOW_FILE}/dispatches`,
        {
          ref: 'master',
          inputs: {
            // workflow_dispatch inputs must be strings, even for what's
            // conceptually a number.
            rollout_percentage: String(rolloutPercentage),
            // Empty string, not omitted, is how "not provided" is conveyed for this optional
            // input — same convention submitIosAppStoreReview() below uses for whats_new.
            whats_new: whatsNew ?? '',
          },
        },
        { headers, timeout: 15_000 },
      );
      return { dispatched: true };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not dispatch ${PROMOTE_ANDROID_WORKFLOW_FILE} on ${this.repo}`,
      );
    }
  }

  /**
   * MANUAL, REAL-PRODUCTION ACTION — the highest-stakes endpoint in this
   * module. Dispatches submit-ios-app-store-review.yml, which submits the
   * current iOS build for Apple's FULL App Store review: real public
   * distribution to every App Store user, not TestFlight. This is
   * workflow_dispatch-only, never runs automatically, and there is no undo
   * endpoint here — once submitted, Apple's review clock starts, and there
   * is no API-level "cancel submission" offered by this module.
   *
   * It DOES auto-release to real users: the workflow forces
   * `releaseType: AFTER_APPROVAL` on the App Store Connect version, so the
   * moment Apple approves the build, it goes live to every real App Store
   * user with no further click. It also does not prepare the App Store
   * Connect listing itself (screenshots, release notes, etc.) — that is
   * human content work assumed already done before this is ever called.
   *
   * DEPLOYMENT PREREQUISITE: same as promoteAndroid() above, dispatching a
   * workflow requires `Actions: write` scope on GITHUB_ACTIONS_TOKEN. A 403
   * or 404 from GitHub here is the likely symptom of a still-read-only
   * token.
   *
   * `whatsNew`, when provided, overwrites the "What's New in This Version"
   * text on the App Store listing before submission; omitted (or left
   * empty), whatever's already set in App Store Connect is left untouched —
   * see submit-ios-app-store-review.yml's own whats_new input handling.
   */
  async submitIosAppStoreReview(
    whatsNew?: string,
  ): Promise<MobileDispatchResponseDto> {
    const headers = this.headers;

    try {
      // GitHub returns 204 No Content with an empty body on success — do not
      // attempt to read/parse `data` from this response.
      await axios.post(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${SUBMIT_IOS_APP_STORE_REVIEW_WORKFLOW_FILE}/dispatches`,
        {
          ref: 'master',
          // workflow_dispatch string inputs must always be strings — an
          // empty string is how "not provided" is conveyed for this
          // optional input.
          inputs: { whats_new: whatsNew ?? '' },
        },
        { headers, timeout: 15_000 },
      );
      return { dispatched: true };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not dispatch ${SUBMIT_IOS_APP_STORE_REVIEW_WORKFLOW_FILE} on ${this.repo}`,
      );
    }
  }

  /** Throws when any App Store Connect credential is unset — every caller must refuse cleanly rather than mint a JWT with missing/partial credentials. */
  private requireAppStoreConnectConfig() {
    const { issuerId, apiKeyId, privateKey, testflightExternalGroupName } =
      this.configService.appStoreConnect;
    if (!issuerId || !apiKeyId || !privateKey || !testflightExternalGroupName) {
      throw new ServiceUnavailableException(
        'APPSTORE_ISSUER_ID / APPSTORE_API_KEY_ID / APPSTORE_API_PRIVATE_KEY / ' +
          'TESTFLIGHT_EXTERNAL_GROUP_NAME are not fully configured on this ' +
          'environment, so iOS TestFlight status cannot be read.',
      );
    }
    return { issuerId, apiKeyId, privateKey, testflightExternalGroupName };
  }

  /**
   * Mints a short-lived (19-minute) ES256 JWT per Apple's App Store Connect
   * API auth scheme. The private key is parsed with Node's own
   * `crypto.createPrivateKey` rather than handed to `jsonwebtoken` as a raw
   * string: jsonwebtoken's own PEM handling gives one opaque, generic error
   * ("secretOrPrivateKey must be an asymmetric key when using ES256") no
   * matter what's actually wrong with the key, whereas Node's decoder gives
   * the real, specific parse error — the difference that cost hours of
   * debugging on this exact key.
   */
  private mintAppStoreConnectJwt(): string {
    const { issuerId, apiKeyId, privateKey } =
      this.requireAppStoreConnectConfig();

    const normalizedPem = normalizeAppStoreConnectPrivateKey(privateKey);

    let keyObject: crypto.KeyObject;
    try {
      keyObject = crypto.createPrivateKey({
        key: normalizedPem,
        format: 'pem',
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `APPSTORE_API_PRIVATE_KEY could not be parsed as a PEM private key ` +
          `(${describePemShape(normalizedPem)}). Node crypto error: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }

    if (keyObject.asymmetricKeyType !== 'ec') {
      throw new ServiceUnavailableException(
        `APPSTORE_API_PRIVATE_KEY is not an EC private key (got ` +
          `"${keyObject.asymmetricKeyType}") — App Store Connect requires an ` +
          `ES256 (P-256) key.`,
      );
    }
    const namedCurve = keyObject.asymmetricKeyDetails?.namedCurve;
    if (namedCurve && namedCurve !== 'prime256v1') {
      throw new ServiceUnavailableException(
        `APPSTORE_API_PRIVATE_KEY is not a P-256 (prime256v1) EC key (got ` +
          `"${namedCurve}") — App Store Connect requires ES256.`,
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: issuerId,
        iat: nowSeconds,
        exp: nowSeconds + APPSTORE_JWT_TTL_SECONDS,
        aud: APPSTORE_JWT_AUDIENCE,
      },
      keyObject,
      { algorithm: 'ES256', keyid: apiKeyId },
    );
  }

  private get appStoreConnectHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.mintAppStoreConnectJwt()}` };
  }

  /**
   * Live TestFlight review status for the current iOS build — a read-only
   * dashboard view, no caching (same reasoning as the rest of this module).
   * Returns 200 with all-null/false fields when there's simply no processed
   * build yet; that's a normal, expected state (still processing, or none
   * uploaded), not a failure. Only genuine upstream failures (auth, network,
   * unexpected non-2xx) throw via toReadableError.
   */
  async getIosTestflightStatus(): Promise<IosTestflightStatusResponseDto> {
    const { testflightExternalGroupName } = this.requireAppStoreConnectConfig();
    const headers = this.appStoreConnectHeaders;

    const appId = await this.fetchAppStoreConnectAppId(headers);
    const build = await this.fetchLatestValidBuild(appId, headers);

    if (!build) {
      return {
        buildVersion: null,
        buildId: null,
        betaReviewState: null,
        externalGroupAssigned: false,
      };
    }

    const [betaReviewState, externalGroupAssigned] = await Promise.all([
      this.fetchBetaReviewState(build.id, headers),
      this.fetchExternalGroupAssigned(
        appId,
        build.id,
        testflightExternalGroupName,
        headers,
      ),
    ]);

    return {
      buildVersion: build.version,
      buildId: build.id,
      betaReviewState,
      externalGroupAssigned,
    };
  }

  /**
   * Review-submission history across the last {@link TESTFLIGHT_HISTORY_BUILD_LIMIT}
   * processed (VALID) iOS builds — same auth/fetch pattern as
   * getIosTestflightStatus(), just listing more than one build. Read-only,
   * no caching. Returns 200 with an empty array when there are simply no
   * processed builds yet, same "empty state is not a failure" convention as
   * the rest of this module. Only genuine upstream failures throw via
   * toReadableError.
   *
   * Apple API calls per request: 1 (app id lookup) + 1 (builds list) + up to
   * TESTFLIGHT_HISTORY_BUILD_LIMIT (one betaAppReviewSubmissions lookup per
   * build, fanned out in parallel) = up to 17.
   */
  async getIosTestflightHistory(): Promise<IosTestflightHistoryResponseDto> {
    this.requireAppStoreConnectConfig();
    const headers = this.appStoreConnectHeaders;

    const appId = await this.fetchAppStoreConnectAppId(headers);
    const builds = await this.fetchRecentValidBuilds(appId, headers);

    if (builds.length === 0) {
      return { history: [] };
    }

    // allSettled, not all — same reasoning as listRuns() above: this fans out
    // to up to TESTFLIGHT_HISTORY_BUILD_LIMIT parallel Apple API calls (one
    // betaAppReviewSubmissions lookup per build), and a single transient
    // failure among them used to fail the whole history list. A failed
    // build's lookup is dropped from the result (not mapped to null — null
    // already means "never submitted for review", a different, misleading
    // thing to show for "the lookup failed").
    const settled = await Promise.allSettled(
      builds.map(async (build) => ({
        buildVersion: build.version,
        buildId: build.id,
        uploadedDate: build.uploadedDate,
        betaReviewState: await this.fetchBetaReviewState(build.id, headers),
      })),
    );

    const history: IosTestflightHistoryEntryDto[] = settled
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<IosTestflightHistoryEntryDto> => {
          if (result.status === 'fulfilled') return true;
          this.logger.warn(
            `Dropping a build from getIosTestflightHistory(): ${
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
            }`,
          );
          return false;
        },
      )
      .map((result) => result.value);

    return {
      history: history.sort(
        (a, b) =>
          new Date(b.uploadedDate).getTime() -
          new Date(a.uploadedDate).getTime(),
      ),
    };
  }

  /**
   * AUTONOMOUS, REAL-PRODUCTION ACTION — the only one in this module that
   * isn't triggered by a human click. Run on a schedule (see
   * IosMinVersionAutoBumpSchedulerRegistrationService), this raises the iOS
   * force-update minimum version the moment — and only the moment — Apple
   * confirms the current build's App Store version is genuinely live to real
   * users.
   *
   * "Live" here means `appVersionState === 'READY_FOR_DISTRIBUTION'`
   * specifically, verified against Apple's real App Store Connect API
   * schema before writing this rather than assumed: `COMPLETE` on a review
   * submission only means Apple finished reviewing it, not that it's
   * downloadable yet — Apple still processes an approved version through
   * `PROCESSING_FOR_DISTRIBUTION` before it reaches READY_FOR_DISTRIBUTION.
   * The submission workflow now forces `releaseType: AFTER_APPROVAL`, so
   * there's no human "click Release" step left in the chain at all — this
   * scheduled check is the only thing verifying the version is actually
   * live before the minimum version moves, not a redundant safety net on
   * top of a manual gate that no longer exists.
   *
   * Deliberately iOS-only. The Play Developer API has no equivalent signal
   * for Android once Managed Publishing is enabled on this app (confirmed
   * by checking Google's own API reference) — `edits.tracks.get` only
   * reflects what was last *committed*, not whether Google's review +
   * manual-publish gate has actually let it through, so there is currently
   * no safe way to build the same automation for Android.
   *
   * A no-op (not an error) when: there's no processed build yet, the build
   * isn't READY_FOR_DISTRIBUTION yet, or the minimum is already at this
   * version. Every actual change is logged and posted to Slack, since this
   * is the one action on this page nobody clicked.
   */
  async autoBumpIosMinimumVersionIfLive(): Promise<void> {
    this.requireAppStoreConnectConfig();
    const headers = this.appStoreConnectHeaders;

    const appId = await this.fetchAppStoreConnectAppId(headers);
    const build = await this.fetchLatestValidBuild(appId, headers);
    if (!build) return;

    const appVersionState = await this.fetchAppStoreVersionState(
      appId,
      build.version,
      headers,
    );
    if (appVersionState !== 'READY_FOR_DISTRIBUTION') return;

    const current =
      await this.appVersionSettingsService.getAppVersionSettings('ios');
    if (current.minimumSupportedVersion === build.version) return;

    await this.appVersionSettingsService.updateAppVersionSettings({
      ios: build.version,
    });

    this.logger.info(
      `Auto-raised iOS minimum supported version from ${current.minimumSupportedVersion} to ` +
        `${build.version} — Apple confirmed READY_FOR_DISTRIBUTION.`,
    );
    await this.slackService.sendMessage(
      `iOS minimum supported version auto-raised to ${build.version} — Apple confirmed it's ` +
        `live (READY_FOR_DISTRIBUTION). Previous minimum was ${current.minimumSupportedVersion}. ` +
        'No human action taken; this ran on schedule.',
    );
  }

  /** null if no appStoreVersions resource matches `versionString` yet (e.g. not created, or already replaced). */
  private async fetchAppStoreVersionState(
    appId: string,
    versionString: string,
    headers: Record<string, string>,
  ): Promise<string | null> {
    try {
      const { data } = await axios.get(
        `${APPSTORE_CONNECT_API}/apps/${appId}/appStoreVersions`,
        {
          headers,
          params: {
            'filter[platform]': 'IOS',
            'filter[versionString]': versionString,
            'fields[appStoreVersions]': 'versionString,appVersionState',
            limit: 1,
          },
          timeout: 15_000,
        },
      );
      return data?.data?.[0]?.attributes?.appVersionState ?? null;
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not look up appVersionState for iOS version ${versionString}`,
      );
    }
  }

  /** Throws when ANDROID_SERVICE_ACCOUNT_JSON is unset — every caller must refuse cleanly rather than authenticate with no credentials. */
  private requireAndroidPublisherConfig(): string {
    const { serviceAccountJson } = this.configService.androidPublisher;
    if (!serviceAccountJson) {
      throw new ServiceUnavailableException(
        'ANDROID_SERVICE_ACCOUNT_JSON is not configured on this environment, so the Android production track cannot be read.',
      );
    }
    return serviceAccountJson;
  }

  /**
   * Live Play Developer API production-track status for the current Android app — read-only,
   * no caching, same pattern as the rest of this module. Powers the admin dashboard's Android
   * pipeline "Publish" stage, which previously had no live signal at all and showed a static
   * placeholder. Shares fetchAndroidProductionRelease() with the auto-bump task below rather
   * than duplicating the Play Developer API call.
   *
   * Deliberately doesn't say "live" anywhere in its own shape — `status`/`userFraction` are
   * passed through verbatim, same as this module does for Apple's raw enum values elsewhere,
   * so the frontend (and whoever reads this response) decides what those mean rather than this
   * endpoint asserting more certainty than the underlying signal actually carries, especially
   * given `status: 'completed'` is only a trustworthy "genuinely live" signal once Managed
   * Publishing is off for this app.
   */
  async getAndroidProductionStatus(): Promise<AndroidProductionStatusResponseDto> {
    const release = await this.fetchAndroidProductionRelease();
    return {
      status: release?.status ?? null,
      versionCodes: release?.versionCodes ?? [],
      userFraction: release?.userFraction ?? null,
    };
  }

  /**
   * AUTONOMOUS, REAL-PRODUCTION ACTION — Android's counterpart to
   * autoBumpIosMinimumVersionIfLive() above, run on the same 30-minute
   * schedule. Only safe to enable once Managed Publishing is OFF for this
   * app in Play Console: with it on, a track's release `status` reflects
   * what was last *committed*, not whether Google's review-then-manual-
   * publish gate has actually let it through — confirmed by checking
   * Google's own Play Developer API reference before building this, the
   * same discipline as the iOS side. With Managed Publishing off, `status:
   * 'completed'` on the production track is a trustworthy "this is really
   * live" signal, the same role READY_FOR_DISTRIBUTION plays for iOS.
   *
   * Matches the production release to the *current* build by exact
   * versionCode equality against what's committed on master right now —
   * deliberately strict, not a "close enough" heuristic: if master has
   * already moved on to a newer versionCode this promotion doesn't cover,
   * the match simply fails and this is a no-op until the production track
   * catches up, rather than bumping to a version the resolved versionCode
   * doesn't actually correspond to.
   *
   * A staged rollout (status 'inProgress' with userFraction < 1) is
   * deliberately NOT treated as live — raising the minimum version while
   * only a fraction of users can download the build would lock out
   * everyone else, the exact failure mode this whole feature exists to
   * prevent.
   */
  async autoBumpAndroidMinimumVersionIfLive(): Promise<void> {
    if (!this.configService.androidMinVersionAutoBumpEnabled) {
      this.logger.debug(
        'Skipping Android min-version auto-bump — ANDROID_MIN_VERSION_AUTO_BUMP_ENABLED is not true.',
      );
      return;
    }

    const headers = this.headers;
    const { versionCode, versionName } =
      await this.fetchCurrentAndroidVersion(headers);
    if (!versionCode || !versionName) return;

    const release = await this.fetchAndroidProductionRelease();
    if (!release || release.status !== 'completed') return;
    if (!release.versionCodes.includes(versionCode)) return;

    const current =
      await this.appVersionSettingsService.getAppVersionSettings('android');
    if (current.minimumSupportedVersion === versionName) return;

    await this.appVersionSettingsService.updateAppVersionSettings({
      android: versionName,
    });

    this.logger.info(
      `Auto-raised Android minimum supported version from ${current.minimumSupportedVersion} to ` +
        `${versionName} — production track confirmed status: completed for versionCode ${versionCode}.`,
    );
    await this.slackService.sendMessage(
      `Android minimum supported version auto-raised to ${versionName} — the production track ` +
        `confirmed this build is fully live (not a staged rollout). Previous minimum was ` +
        `${current.minimumSupportedVersion}. No human action taken; this ran on schedule.`,
    );
  }

  /**
   * The production track's highest-versionCode release, or null if the track has none. Reads via
   * a throwaway edit (insert -> tracks.get -> delete) — never committed, so this can never
   * publish anything; the delete is just tidiness, not a correctness requirement, since an
   * uncommitted edit Google doesn't hear from again expires on its own.
   */
  private async fetchAndroidProductionRelease(): Promise<{
    status: string;
    versionCodes: number[];
    userFraction: number | null;
  } | null> {
    const serviceAccountJson = this.requireAndroidPublisherConfig();
    const androidpublisher = google.androidpublisher({
      version: 'v3',
      auth: new google.auth.GoogleAuth({
        credentials: JSON.parse(serviceAccountJson),
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      }),
    });

    let editId: string | undefined;
    try {
      const { data: edit } = await androidpublisher.edits.insert({
        packageName: ANDROID_PACKAGE_NAME,
      });
      editId = edit.id ?? undefined;
      if (!editId) return null;

      const { data: track } = await androidpublisher.edits.tracks.get({
        packageName: ANDROID_PACKAGE_NAME,
        editId,
        track: 'production',
      });

      const releases = track.releases ?? [];
      const latest = releases
        .flatMap((release) =>
          (release.versionCodes ?? []).map((vc) => ({
            release,
            versionCode: Number(vc),
          })),
        )
        .sort((a, b) => b.versionCode - a.versionCode)[0];
      if (!latest) return null;

      return {
        status: latest.release.status ?? '',
        versionCodes: (latest.release.versionCodes ?? []).map(Number),
        userFraction: latest.release.userFraction ?? null,
      };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not read the Android production track for ${ANDROID_PACKAGE_NAME}`,
      );
    } finally {
      if (editId) {
        try {
          await androidpublisher.edits.delete({
            packageName: ANDROID_PACKAGE_NAME,
            editId,
          });
        } catch {
          // Best-effort cleanup only — an uncommitted edit expires on its own regardless.
        }
      }
    }
  }

  /**
   * Apple's own full App Store review submission history — the real
   * public-distribution review (what the App Store Connect UI's "App Store"
   * tab shows as Date Submitted / Versions / Status), distinct from the
   * TestFlight Beta App Review history above which only ever covers
   * TestFlight builds. Read-only, no caching, same auth/fetch pattern as the
   * rest of this module. Only 2 Apple API calls per request (app id lookup +
   * the reviewSubmissions list itself, with the version string resolved via
   * `include=appStoreVersionForReview` in the same call) — no per-item
   * fan-out needed, unlike getIosTestflightHistory's betaReviewState lookups.
   */
  async getIosAppStoreReviewSubmissions(): Promise<IosAppStoreReviewSubmissionsResponseDto> {
    this.requireAppStoreConnectConfig();
    const headers = this.appStoreConnectHeaders;

    const appId = await this.fetchAppStoreConnectAppId(headers);
    const submissions = await this.fetchRecentAppStoreReviewSubmissions(
      appId,
      headers,
    );

    return { submissions };
  }

  private async fetchRecentAppStoreReviewSubmissions(
    appId: string,
    headers: Record<string, string>,
  ): Promise<IosAppStoreReviewSubmissionEntryDto[]> {
    try {
      const { data } = await axios.get(
        `${APPSTORE_CONNECT_API}/apps/${appId}/reviewSubmissions`,
        {
          headers,
          params: {
            'filter[platform]': 'IOS',
            include: 'appStoreVersionForReview',
            limit: APP_STORE_REVIEW_SUBMISSION_LIMIT,
            'fields[reviewSubmissions]':
              'submittedDate,state,appStoreVersionForReview',
            'fields[appStoreVersions]': 'versionString',
          },
          timeout: 15_000,
        },
      );
      const included = data?.included ?? [];
      const entries: IosAppStoreReviewSubmissionEntryDto[] = (data?.data ?? [])
        .filter((submission: any) => submission?.id)
        .map((submission: any) => {
          const versionId =
            submission?.relationships?.appStoreVersionForReview?.data?.id;
          const versionResource = included.find(
            (item: any) =>
              item?.type === 'appStoreVersions' && item?.id === versionId,
          );
          return {
            versionString: String(
              versionResource?.attributes?.versionString ?? '',
            ),
            submittedDate: String(submission?.attributes?.submittedDate ?? ''),
            state: String(submission?.attributes?.state ?? ''),
          };
        });
      return entries.sort(
        (a, b) =>
          new Date(b.submittedDate).getTime() -
          new Date(a.submittedDate).getTime(),
      );
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not list App Store review submissions for App Store Connect app ${appId}`,
      );
    }
  }

  private async fetchRecentValidBuilds(
    appId: string,
    headers: Record<string, string>,
  ): Promise<{ id: string; version: string; uploadedDate: string }[]> {
    try {
      const { data } = await axios.get(`${APPSTORE_CONNECT_API}/builds`, {
        headers,
        params: {
          'filter[app]': appId,
          'filter[processingState]': 'VALID',
          sort: '-uploadedDate',
          limit: TESTFLIGHT_HISTORY_BUILD_LIMIT,
          include: 'preReleaseVersion',
        },
        timeout: 15_000,
      });
      const included = data?.included ?? [];
      return (data?.data ?? [])
        .filter((build: any) => build?.id)
        .map((build: any) => ({
          id: String(build.id),
          version: resolveMarketingVersion(build, included),
          uploadedDate: String(build.attributes?.uploadedDate ?? ''),
        }));
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not list builds for App Store Connect app ${appId}`,
      );
    }
  }

  private async fetchAppStoreConnectAppId(
    headers: Record<string, string>,
  ): Promise<string> {
    try {
      const { data } = await axios.get(`${APPSTORE_CONNECT_API}/apps`, {
        headers,
        params: { 'filter[bundleId]': APPSTORE_BUNDLE_ID },
        timeout: 15_000,
      });
      const appId = data?.data?.[0]?.id;
      if (!appId) {
        throw new Error(
          `No App Store Connect app found for bundle id ${APPSTORE_BUNDLE_ID}`,
        );
      }
      return String(appId);
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not look up the App Store Connect app id for ${APPSTORE_BUNDLE_ID}`,
      );
    }
  }

  private async fetchLatestValidBuild(
    appId: string,
    headers: Record<string, string>,
  ): Promise<{ id: string; version: string } | null> {
    try {
      const { data } = await axios.get(`${APPSTORE_CONNECT_API}/builds`, {
        headers,
        params: {
          'filter[app]': appId,
          'filter[processingState]': 'VALID',
          sort: '-uploadedDate',
          limit: 1,
          include: 'preReleaseVersion',
        },
        timeout: 15_000,
      });
      const build = data?.data?.[0];
      if (!build?.id) {
        return null;
      }
      return {
        id: String(build.id),
        version: resolveMarketingVersion(build, data?.included ?? []),
      };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not list builds for App Store Connect app ${appId}`,
      );
    }
  }

  /** null when the build has never been submitted for Beta App Review — App Store Connect shows this as "Ready to Submit". */
  private async fetchBetaReviewState(
    buildId: string,
    headers: Record<string, string>,
  ): Promise<string | null> {
    try {
      const { data } = await axios.get(
        `${APPSTORE_CONNECT_API}/betaAppReviewSubmissions`,
        {
          headers,
          params: { 'filter[build]': buildId },
          timeout: 15_000,
        },
      );
      const submission = data?.data?.[0];
      return submission?.attributes?.betaReviewState
        ? String(submission.attributes.betaReviewState)
        : null;
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not read betaAppReviewSubmissions for build ${buildId}`,
      );
    }
  }

  /**
   * Whether `buildId` is a member of the named external testing group. Checked from the
   * GROUP's side, not the build's: GET /v1/builds/{id}/betaGroups doesn't exist on Apple's API
   * (confirmed live — it 409s with "The relationship 'betaGroups' does not allow
   * 'GET_RELATED'. Allowed operations are: CREATE, DELETE"), and the relationship-links variant
   * at /v1/builds/{id}/relationships/betaGroups only supports POST/DELETE, no GET either.
   * GET /v1/betaGroups/{id}/relationships/builds does support GET, so membership has to be
   * checked from the group looking at its builds, the reverse direction from what "is this
   * build in that group" reads like. Verified against Apple's own current OpenAPI spec.
   */
  private async fetchExternalGroupAssigned(
    appId: string,
    buildId: string,
    externalGroupName: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    try {
      const { data: groupsData } = await axios.get(
        `${APPSTORE_CONNECT_API}/betaGroups`,
        {
          headers,
          params: {
            'filter[app]': appId,
            'filter[name]': externalGroupName,
            limit: 1,
          },
          timeout: 15_000,
        },
      );
      const groupId = groupsData?.data?.[0]?.id;
      if (!groupId) {
        // No group with this name exists (yet) — not assigned to it, but not an error either;
        // the same "not found" case ally-mobile's promote-ios-testflight.mjs treats as a clear
        // configuration problem (wrong TESTFLIGHT_EXTERNAL_GROUP_NAME) rather than surfacing it
        // here, since a stale/misconfigured group name shouldn't break the whole status view.
        return false;
      }

      // Lightweight relationship-links form (just {type, id} pairs), not the full betaGroups
      // GET /v1/betaGroups/{id}/builds resource form — cheaper, and all that's needed here.
      const { data: buildsData } = await axios.get(
        `${APPSTORE_CONNECT_API}/betaGroups/${groupId}/relationships/builds`,
        { headers, params: { limit: 200 }, timeout: 15_000 },
      );
      const buildIds: string[] = (buildsData?.data ?? []).map((b: any) =>
        String(b?.id ?? ''),
      );
      return buildIds.includes(buildId);
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not check whether build ${buildId} is in the "${externalGroupName}" beta group`,
      );
    }
  }

  private async fetchFileContent(
    path: string,
    headers: Record<string, string>,
  ): Promise<string> {
    try {
      const { data } = await axios.get(
        `${GITHUB_API}/repos/${this.repo}/contents/${path}`,
        { headers, params: { ref: 'master' }, timeout: 15_000 },
      );
      const content = data?.content;
      if (!content) {
        throw new Error(`No content returned for ${path}`);
      }
      return Buffer.from(String(content), 'base64').toString('utf-8');
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not read ${path} from ${this.repo}@master`,
      );
    }
  }

  /**
   * The upstream API's own error text is far more useful to an admin than a
   * generic 502 ("Not Found", "Bad credentials"), so it is surfaced rather
   * than swallowed. Mirrors GithubActionsService.toReadableError. Handles
   * both GitHub's `{ message }` error body and App Store Connect's JSON:API
   * `{ errors: [{ title, detail }] }` shape.
   */
  private toReadableError(error: unknown, prefix: string): Error {
    const axiosError = error as AxiosError<{
      message?: string;
      errors?: { title?: string; detail?: string }[];
    }>;
    const appStoreConnectError = axiosError?.response?.data?.errors?.[0];
    const detail =
      axiosError?.response?.data?.message ??
      (appStoreConnectError
        ? `${appStoreConnectError.title ?? ''} ${appStoreConnectError.detail ?? ''}`.trim()
        : undefined) ??
      (error instanceof Error ? error.message : String(error));
    const status = axiosError?.response?.status;
    this.logger.error(`${prefix}: ${status ?? ''} ${detail}`);
    return new ServiceUnavailableException(`${prefix}: ${detail}`);
  }
}
