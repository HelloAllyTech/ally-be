import { Injectable } from '@nestjs/common';

import { LogsService } from 'src/logs/logs.service';
import { AwsLogServiceKey } from 'src/config/config.service';
import { PosthogQueryService } from 'src/ux-signals/service/posthog-query.service';

import { BugFindingRepository } from '../repository/bug-finding.repository';
import { redactPii } from '../util/redact-pii.util';

/** Repos with a CloudWatch log group. Frontend repos have no server-side log group to query. */
const AWS_LOG_SERVICE_KEYS: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];

/** Repos with a browser client sending PostHog `$exception` events. */
const WEB_ERROR_REPOS = ['ally-web'];

const PROD_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ProdLogFinding {
  message: string;
  timestamp: number;
  logStreamName: string;
}

export interface WebErrorFinding {
  type: string;
  message: string;
  url: string;
  occurrences: number;
  lastSeen: string;
}

export interface ReportedBugFinding {
  /** The BugFinding row's own id — reportedBugId (below) is the roadmap opportunity it came from. */
  id: string;
  reportedBugId: string;
  description: string;
  createdAt: Date;
}

/**
 * Read-only data the Discover finders need from OTHER modules, proxied
 * through Bug Hunter's own api-key-guarded surface rather than having finder
 * agents authenticate against `/v1/aws-logs` or `/v1/product-roadmap/*`
 * directly. Those endpoints are `@RequireFeatureToggle`-gated — built for a
 * logged-in human, not a machine caller — and giving the pipeline a second
 * credential type (or a service *user* account) to reach them would spread
 * the auth surface it depends on across two other teams' modules. This way
 * the pipeline only ever needs to know one thing: its own `x-api-key`.
 */
@Injectable()
export class BugHunterFinderDataService {
  constructor(
    private readonly logsService: LogsService,
    private readonly findingRepository: BugFindingRepository,
    private readonly posthog: PosthogQueryService,
  ) {}

  /**
   * Whether this repo has a CloudWatch log group `getRecentErrors` can query
   * at all.
   */
  hasLogGroup(repo: string): boolean {
    return AWS_LOG_SERVICE_KEYS.includes(repo as AwsLogServiceKey);
  }

  /**
   * Whether ANY finder here can see a production signal for this repo without
   * an accompanying commit — CloudWatch logs or PostHog client errors today,
   * more as further finders land (mobile crashes, LiveKit). Used by
   * `BugHunterService.requireWorthSweepingOrRecordSkip` to decide a quiet-night
   * skip is safe: a repo with none of these has no way for a production issue
   * to appear without a matching commit, but one that does could have a real
   * incident (a bad rollback, an upstream outage, a client-side regression)
   * with no matching commit, so it must never be skipped this way — see that
   * method's own doc for why a real anomaly threshold, not this blanket rule,
   * is what would let backend repos skip too.
   */
  hasExternalSignal(repo: string): boolean {
    return this.hasLogGroup(repo) || WEB_ERROR_REPOS.includes(repo);
  }

  /**
   * Last 24h of CloudWatch errors for a repo, or `null` if the repo has no
   * log group (the frontend repos: ally-web, ally-mobile) — the finder should
   * report zero findings for those rather than erroring.
   */
  async getRecentErrors(repo: string): Promise<ProdLogFinding[] | null> {
    if (!AWS_LOG_SERVICE_KEYS.includes(repo as AwsLogServiceKey)) return null;

    const endTime = Date.now();
    const startTime = endTime - PROD_LOG_WINDOW_MS;
    const { events } = await this.logsService.getLogEvents({
      service: repo as AwsLogServiceKey,
      startTime,
      endTime,
      level: 'ERROR',
    });
    return events.map((event) => ({
      message: event.message,
      timestamp: event.timestamp,
      logStreamName: event.logStreamName,
    }));
  }

  /**
   * Last 24h of browser-side `$exception` events for a repo, or `null` if the
   * repo has no PostHog-instrumented client (every repo but ally-web today).
   * Grouped server-side by (type, message, url) rather than returned as raw
   * events — PostHog's `$exception_message` and `$current_url` can carry
   * interpolated user content (an email in a validation error, say), so
   * `redactPii` strips it before this ever reaches a prompt or a
   * `bug_findings` row. Falls back to an empty list rather than throwing when
   * PostHog is unreachable or unconfigured — a finder outage should never fail
   * the whole sweep over one data source.
   */
  async getWebErrors(repo: string): Promise<WebErrorFinding[] | null> {
    if (!WEB_ERROR_REPOS.includes(repo)) return null;
    if (!this.posthog.enabled) return [];

    try {
      const result = await this.posthog.query(`
        SELECT
          toString(properties.$exception_type) AS type,
          toString(properties.$exception_message) AS message,
          toString(properties.$current_url) AS url,
          count() AS occurrences,
          max(timestamp) AS lastSeen
        FROM events
        WHERE event = '$exception'
          AND timestamp >= now() - INTERVAL 1 DAY
        GROUP BY type, message, url
        ORDER BY occurrences DESC
        LIMIT 50
      `);
      const columns = result.columns;
      const idx = (name: string): number => columns.indexOf(name);
      return result.results.map((row) => ({
        type: redactPii(String(row[idx('type')] ?? '')),
        message: redactPii(String(row[idx('message')] ?? '')),
        url: redactPii(String(row[idx('url')] ?? '')),
        occurrences: Number(row[idx('occurrences')] ?? 0),
        lastSeen: String(row[idx('lastSeen')] ?? ''),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Human-reported bugs still at BugFindingStatus.NEW, platform-wide (a
   * BugFinding row has no repo yet until this finder judges which one it's
   * about — see BugFinding.repo's doc). Every row here was created the moment
   * the bug was filed on the roadmap (RoadmapOpportunityService.create), not
   * by this finder — this is a read of that queue, not its source of truth.
   */
  async getReportedBugs(): Promise<ReportedBugFinding[]> {
    const rows = await this.findingRepository.listNewReportedBugs();
    return rows.map((row) => ({
      id: row.id,
      reportedBugId: row.reportedBugId as string,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }
}
