import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  MOBILE_WORKFLOW_FILES,
  MOBILE_WORKFLOW_LABELS,
  MobileCurrentVersionResponseDto,
  MobileReleaseRunDto,
  MobileWorkflowFile,
} from './dto/mobile-releases.dto';

const GITHUB_API = 'https://api.github.com';

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
   */
  async getCurrentVersion(): Promise<MobileCurrentVersionResponseDto> {
    const headers = this.headers;

    const [gradle, pbxproj] = await Promise.all([
      this.fetchFileContent('android/app/build.gradle', headers),
      this.fetchFileContent('ios/ally.xcodeproj/project.pbxproj', headers),
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
    };
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
