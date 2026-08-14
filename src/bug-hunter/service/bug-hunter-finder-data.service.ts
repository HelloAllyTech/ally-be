import { Injectable } from '@nestjs/common';

import { LogsService } from 'src/logs/logs.service';
import { AwsLogServiceKey } from 'src/config/config.service';

import { BugFindingRepository } from '../repository/bug-finding.repository';

/** Repos with a CloudWatch log group. Frontend repos have no server-side log group to query. */
const AWS_LOG_SERVICE_KEYS: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];

const PROD_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ProdLogFinding {
  message: string;
  timestamp: number;
  logStreamName: string;
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
  ) {}

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
