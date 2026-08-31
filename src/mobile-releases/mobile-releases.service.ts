import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
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
const PROMOTE_IOS_WORKFLOW_FILE: MobileWorkflowFile =
  'promote-ios-testflight-external.yml';
const MS_PER_HOUR = 60 * 60 * 1000;
const CADENCE_GATE_HOURS = 48;
const DAILY_CHECK_UTC_HOUR = 5; // matches scheduled-mobile-release.yml's `cron: '0 5 * * *'`

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

  constructor(private readonly configService: AppConfigService) {}

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
   */
  async listRuns(): Promise<MobileReleaseRunDto[]> {
    const headers = this.headers;

    const runsPerWorkflow = await Promise.all(
      MOBILE_WORKFLOW_FILES.map((file) =>
        this.fetchWorkflowRuns(file, headers),
      ),
    );

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

    const [gradle, pbxproj, nextEligibleCheckAt] = await Promise.all([
      this.fetchFileContent('android/app/build.gradle', headers),
      this.fetchFileContent('ios/ally.xcodeproj/project.pbxproj', headers),
      this.computeNextEligibleCheckAt(headers),
    ]);

    const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
    const versionNameMatch = gradle.match(/versionName\s+"([^"]+)"/);
    const marketingVersionMatch = pbxproj.match(
      /MARKETING_VERSION\s*=\s*([^;]+);/,
    );

    return {
      android: {
        versionCode: versionCodeMatch ? Number(versionCodeMatch[1]) : null,
        versionName: versionNameMatch ? versionNameMatch[1] : null,
      },
      ios: {
        marketingVersion: marketingVersionMatch
          ? marketingVersionMatch[1].trim()
          : null,
      },
      nextEligibleCheckAt,
    };
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
   */
  async promoteAndroid(
    rolloutPercentage: number,
  ): Promise<MobileDispatchResponseDto> {
    const headers = this.headers;

    try {
      // GitHub returns 204 No Content with an empty body on success — do not
      // attempt to read/parse `data` from this response.
      await axios.post(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${PROMOTE_ANDROID_WORKFLOW_FILE}/dispatches`,
        {
          ref: 'master',
          // workflow_dispatch inputs must be strings, even for what's
          // conceptually a number.
          inputs: { rollout_percentage: String(rolloutPercentage) },
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
   * MANUAL, REAL-PRODUCTION ACTION. Dispatches
   * promote-ios-testflight-external.yml, which promotes the current
   * TestFlight internal build to the external testing group — this is
   * workflow_dispatch-only, never runs automatically, and takes no inputs.
   *
   * DEPLOYMENT PREREQUISITE (on the ally-mobile side, not here): the
   * workflow reads a `TESTFLIGHT_EXTERNAL_GROUP_NAME` repo variable to know
   * which external group to promote into. That variable lives in GitHub
   * Actions on HelloAllyTech/ally-mobile — this backend does not need to
   * know its value, only that the workflow depends on it being set.
   */
  async promoteIosTestflight(): Promise<MobileDispatchResponseDto> {
    const headers = this.headers;

    try {
      // GitHub returns 204 No Content with an empty body on success — do not
      // attempt to read/parse `data` from this response.
      await axios.post(
        `${GITHUB_API}/repos/${this.repo}/actions/workflows/${PROMOTE_IOS_WORKFLOW_FILE}/dispatches`,
        { ref: 'master', inputs: {} },
        { headers, timeout: 15_000 },
      );
      return { dispatched: true };
    } catch (error) {
      throw this.toReadableError(
        error,
        `Could not dispatch ${PROMOTE_IOS_WORKFLOW_FILE} on ${this.repo}`,
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
   * GitHub's own error text is far more useful to an admin than a generic
   * 502 ("Not Found", "Bad credentials"), so it is surfaced rather than
   * swallowed. Mirrors GithubActionsService.toReadableError.
   */
  private toReadableError(error: unknown, prefix: string): Error {
    const axiosError = error as AxiosError<{ message?: string }>;
    const detail =
      axiosError?.response?.data?.message ??
      (error instanceof Error ? error.message : String(error));
    const status = axiosError?.response?.status;
    this.logger.error(`${prefix}: ${status ?? ''} ${detail}`);
    return new ServiceUnavailableException(`${prefix}: ${detail}`);
  }
}
